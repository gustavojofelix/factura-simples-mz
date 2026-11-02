-- Base fiscal do Assistente: editor no backoffice e perguntas sem resposta
--
--  1. Fluxo editorial. Com um editor, um artigo gravado sem estado explícito
--     não pode ir directo para a IA: o estado por omissão passa a
--     'revisao_pendente'. Quem publica fica registado (reviewed_by/at) — num
--     texto fiscal é preciso saber quem o aprovou.
--
--  2. Pesquisa partilhada. ai_knowledge_lookup concentra a lógica de pesquisa
--     (estrita, depois qualquer palavra) para que o assistente e o painel
--     "Testar pergunta" do backoffice devolvam exactamente o mesmo, com a
--     diferença de o backoffice poder incluir artigos ainda em revisão.
--
--  3. Perguntas sem resposta. Cada pesquisa do assistente que não encontra
--     nenhum artigo publicado fica em ai_knowledge_gaps, para o backoffice
--     saber que artigos escrever a seguir.

-- ---------------------------------------------------------------------------
-- 1. Fluxo editorial
-- ---------------------------------------------------------------------------

ALTER TABLE public.ai_knowledge_articles
  ALTER COLUMN status SET DEFAULT 'revisao_pendente';

ALTER TABLE public.ai_knowledge_articles
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Quem grava um artigo publicado — ao publicá-lo ou ao alterar o conteúdo de
-- um que já estava publicado — é quem responde pelo texto que a IA passa a
-- usar. O carimbo é feito aqui e não no cliente, para não poder ser forjado.
CREATE OR REPLACE FUNCTION public.ai_knowledge_stamp_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);

  IF NEW.status = 'publicado' AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.title IS DISTINCT FROM NEW.title
       OR OLD.body IS DISTINCT FROM NEW.body
       OR OLD.question_variants IS DISTINCT FROM NEW.question_variants
       OR OLD.legal_reference IS DISTINCT FROM NEW.legal_reference
       OR OLD.company_id IS DISTINCT FROM NEW.company_id
     ) THEN
    NEW.reviewed_by := COALESCE(auth.uid(), NEW.reviewed_by);
    NEW.reviewed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_stamp_review ON public.ai_knowledge_articles;
CREATE TRIGGER ai_knowledge_stamp_review
  BEFORE INSERT OR UPDATE ON public.ai_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_stamp_review();

-- ---------------------------------------------------------------------------
-- 3. Perguntas sem resposta (criada antes da pesquisa, que a referencia)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  -- Forma normalizada, para agrupar a mesma pergunta escrita de formas
  -- ligeiramente diferentes (acentos, maiúsculas, grafia AO90).
  query_norm text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'resolvida', 'ignorada')),
  resolved_article_id uuid REFERENCES public.ai_knowledge_articles(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_gaps_status
  ON public.ai_knowledge_gaps (status, query_norm, created_at DESC);

ALTER TABLE public.ai_knowledge_gaps ENABLE ROW LEVEL SECURITY;

-- As perguntas podem mencionar dados do negócio do utilizador: só os admins
-- as vêem. A inserção é feita por ai_search_knowledge (SECURITY DEFINER).
DROP POLICY IF EXISTS "Admins manage knowledge gaps" ON public.ai_knowledge_gaps;
CREATE POLICY "Admins manage knowledge gaps"
  ON public.ai_knowledge_gaps FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, UPDATE, DELETE ON public.ai_knowledge_gaps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_gaps TO service_role;

COMMENT ON TABLE public.ai_knowledge_gaps IS
  'Pesquisas do assistente na base fiscal que não devolveram nenhum artigo publicado. Alimenta a lista "Perguntas sem resposta" do backoffice.';

-- ---------------------------------------------------------------------------
-- 2. Pesquisa partilhada
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_knowledge_lookup(
  p_query text,
  p_company_id uuid,
  p_limit integer,
  p_include_drafts boolean
)
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  category text,
  body text,
  legal_reference text,
  status text,
  company_id uuid,
  relevancia real,
  tentativa text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10);
  v_norm text := public.ai_knowledge_normalize(trim(COALESCE(p_query, '')));
  v_statuses text[] := CASE WHEN p_include_drafts
                            THEN ARRAY['publicado', 'revisao_pendente']
                            ELSE ARRAY['publicado'] END;
  v_ts tsquery;
  v_found integer;
BEGIN
  IF length(v_norm) < 2 THEN
    RETURN;
  END IF;

  -- 1.ª tentativa: todas as palavras (mais precisa).
  v_ts := websearch_to_tsquery('portuguese', v_norm);

  RETURN QUERY
    SELECT a.id, a.slug, a.title, a.category, a.body, a.legal_reference,
           a.status, a.company_id, ts_rank(a.search_vector, v_ts), 'estrita'::text
      FROM public.ai_knowledge_articles a
     WHERE a.status = ANY (v_statuses)
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND (a.search_vector @@ v_ts
            OR public.ai_knowledge_normalize(a.title) LIKE '%' || v_norm || '%')
     ORDER BY ts_rank(a.search_vector, v_ts) DESC, a.sort_order
     LIMIT v_limit;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found > 0 THEN
    RETURN;
  END IF;

  -- 2.ª tentativa: qualquer palavra relevante, ordenada por relevância.
  -- Os lexemas já vêm normalizados: o cast directo evita reprocessá-los.
  SELECT string_agg(quote_literal(l.lexeme), ' | ')::tsquery
    INTO v_ts
    FROM unnest(to_tsvector('portuguese', v_norm)) l
   WHERE l.lexeme NOT IN ('ispc', 'facil');  -- presentes em quase todos os artigos

  IF v_ts IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT a.id, a.slug, a.title, a.category, a.body, a.legal_reference,
           a.status, a.company_id, ts_rank(a.search_vector, v_ts), 'qualquer_palavra'::text
      FROM public.ai_knowledge_articles a
     WHERE a.status = ANY (v_statuses)
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND a.search_vector @@ v_ts
     ORDER BY ts_rank(a.search_vector, v_ts) DESC, a.sort_order
     LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_knowledge_lookup(text, uuid, integer, boolean) FROM public, anon, authenticated;

-- A ferramenta do assistente. Passa a VOLATILE porque regista as pesquisas
-- sem resultado; a assinatura e o formato de saída mantêm-se.
CREATE OR REPLACE FUNCTION public.ai_search_knowledge(
  p_query text,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_query text := trim(COALESCE(p_query, ''));
  v_rows jsonb;
BEGIN
  IF p_company_id IS NOT NULL THEN
    PERFORM public.ai_guard(p_company_id);
  END IF;

  IF length(v_query) < 2 THEN
    RETURN jsonb_build_object('artigos', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'titulo', l.title,
           'categoria', l.category,
           'conteudo', l.body,
           'referencia_legal', l.legal_reference
         ) ORDER BY l.relevancia DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.ai_knowledge_lookup(v_query, p_company_id, p_limit, false) l;

  IF jsonb_array_length(v_rows) = 0 THEN
    INSERT INTO public.ai_knowledge_gaps (query, query_norm, company_id, user_id)
    VALUES (left(v_query, 500),
            left(public.ai_knowledge_normalize(v_query), 500),
            p_company_id,
            auth.uid());
  END IF;

  RETURN jsonb_build_object('consulta', v_query, 'artigos', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_search_knowledge(text, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_search_knowledge(text, uuid, integer) TO authenticated;

-- Substituída por ai_knowledge_lookup.
DROP FUNCTION IF EXISTS public.ai_search_knowledge_rows(tsquery, text, uuid, integer);

-- Painel "Testar pergunta" do backoffice: mostra os artigos que o assistente
-- receberia, opcionalmente com os que ainda estão em revisão. Não regista
-- nada em ai_knowledge_gaps.
CREATE OR REPLACE FUNCTION public.ai_admin_test_knowledge_search(
  p_query text,
  p_include_drafts boolean DEFAULT true,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso reservado a administradores.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', l.id,
             'slug', l.slug,
             'title', l.title,
             'category', l.category,
             'status', l.status,
             'company_id', l.company_id,
             'relevancia', round(l.relevancia::numeric, 4),
             'tentativa', l.tentativa
           ) ORDER BY l.relevancia DESC), '[]'::jsonb)
      FROM public.ai_knowledge_lookup(p_query, p_company_id, p_limit, p_include_drafts) l
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_admin_test_knowledge_search(text, boolean, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_admin_test_knowledge_search(text, boolean, uuid, integer) TO authenticated;

-- Lista agrupada das perguntas sem resposta: a mesma pergunta normalizada
-- conta uma vez, com o número de ocorrências e de empresas distintas.
CREATE OR REPLACE FUNCTION public.ai_admin_knowledge_gaps(
  p_status text DEFAULT 'aberta',
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso reservado a administradores.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'ocorrencias')::integer DESC, g->>'ultima' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'query_norm', k.query_norm,
                 -- A formulação mais recente, para mostrar ao editor.
                 'exemplo', (array_agg(k.query ORDER BY k.created_at DESC))[1],
                 'variantes', to_jsonb((array_agg(DISTINCT k.query))[1:5]),
                 'ocorrencias', count(*),
                 'empresas', count(DISTINCT k.company_id),
                 'primeira', min(k.created_at),
                 'ultima', max(k.created_at),
                 'resolved_article_id', (array_agg(k.resolved_article_id ORDER BY k.resolved_at DESC NULLS LAST))[1]
               ) AS g
          FROM public.ai_knowledge_gaps k
         WHERE k.status = COALESCE(p_status, 'aberta')
         GROUP BY k.query_norm
         ORDER BY max(k.created_at) DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
      ) s
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_admin_knowledge_gaps(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_admin_knowledge_gaps(text, integer) TO authenticated;

-- Fecha todas as ocorrências de uma pergunta (agrupada pela forma
-- normalizada) de uma vez, opcionalmente associando o artigo que a cobre.
CREATE OR REPLACE FUNCTION public.ai_admin_resolve_knowledge_gap(
  p_query_norm text,
  p_status text,
  p_article_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso reservado a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('aberta', 'resolvida', 'ignorada') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  UPDATE public.ai_knowledge_gaps
     SET status = p_status,
         resolved_article_id = CASE WHEN p_status = 'resolvida' THEN p_article_id END,
         resolved_by = CASE WHEN p_status = 'aberta' THEN NULL ELSE auth.uid() END,
         resolved_at = CASE WHEN p_status = 'aberta' THEN NULL ELSE now() END
   WHERE query_norm = p_query_norm
     AND status <> p_status;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_admin_resolve_knowledge_gap(text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_admin_resolve_knowledge_gap(text, text, uuid) TO authenticated;
