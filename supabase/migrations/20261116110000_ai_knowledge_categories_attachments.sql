-- Base fiscal do Assistente Virtual: categorias editáveis e anexos legais.
--
-- 1. Categorias (ai_knowledge_categories)
--    Deixam de ser uma lista fixa no código: o back office cria e renomeia
--    categorias. O código (ex.: 'modelo_30') é a chave usada pelos artigos e
--    não muda; o nome mostrado pode ser alterado à vontade.
--
-- 2. Anexos (ai_knowledge_attachments)
--    Cada artigo pode ter ficheiros da base legal (lei, regulamento, circular).
--    O ficheiro fica no bucket público 'ai-knowledge' (são documentos legais
--    públicos) e o texto extraído no browser, ao carregar, fica em
--    content_text. O admin pode corrigir esse texto (ex.: PDF digitalizado).
--
-- 3. A IA lê os anexos
--    O texto de cada anexo é dividido em excertos (ai_knowledge_attachment_chunks)
--    com pesquisa por texto integral em português. A ferramenta do assistente
--    (ai_search_knowledge) passa a devolver, além dos artigos:
--      - 'anexos' de cada artigo (nome + ligação), para a resposta os citar;
--      - 'excertos_legais': as passagens dos anexos mais relevantes para a
--        pergunta, só de artigos publicados.
--    Uma pergunta só fica em "Perguntas sem resposta" se não houver nem
--    artigos nem excertos.

-- ---------------------------------------------------------------------------
-- 1. Categorias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_knowledge_categories (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  label       text NOT NULL CHECK (length(trim(label)) > 0),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_knowledge_categories IS
  'Categorias da base fiscal do assistente, geridas no back office.';

ALTER TABLE public.ai_knowledge_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read knowledge categories" ON public.ai_knowledge_categories;
CREATE POLICY "Read knowledge categories"
  ON public.ai_knowledge_categories FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage knowledge categories" ON public.ai_knowledge_categories;
CREATE POLICY "Admins manage knowledge categories"
  ON public.ai_knowledge_categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_categories TO service_role;

INSERT INTO public.ai_knowledge_categories (code, label, sort_order) VALUES
  ('ispc', 'ISPC', 10),
  ('modelo_30', 'Modelo 30', 20),
  ('prazos', 'Prazos', 30),
  ('facturacao', 'Facturação', 40),
  ('aplicacao', 'Aplicação', 50)
ON CONFLICT (code) DO NOTHING;

-- Categorias já usadas por artigos e que não estejam na lista acima.
INSERT INTO public.ai_knowledge_categories (code, label, sort_order)
SELECT DISTINCT a.category, initcap(replace(a.category, '_', ' ')), 100
  FROM public.ai_knowledge_articles a
 WHERE a.category ~ '^[a-z0-9_]{2,40}$'
ON CONFLICT (code) DO NOTHING;

-- Uma categoria em uso não pode ser eliminada (RESTRICT).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_knowledge_articles'::regclass
       AND conname = 'ai_knowledge_articles_category_fkey'
  ) THEN
    ALTER TABLE public.ai_knowledge_articles
      ADD CONSTRAINT ai_knowledge_articles_category_fkey
      FOREIGN KEY (category) REFERENCES public.ai_knowledge_categories(code)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Anexos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_knowledge_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    uuid NOT NULL REFERENCES public.ai_knowledge_articles(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  public_url    text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  -- Texto do documento que a IA pode ler (extraído ao carregar, editável).
  content_text  text,
  -- Desligado: o ficheiro continua ligado ao artigo, mas a IA não lê o texto.
  use_in_ai     boolean NOT NULL DEFAULT true,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_knowledge_attachments IS
  'Ficheiros da base legal (leis, regulamentos) ligados aos artigos da base fiscal do assistente.';

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_attachments_article
  ON public.ai_knowledge_attachments (article_id);

ALTER TABLE public.ai_knowledge_attachments ENABLE ROW LEVEL SECURITY;

-- Só o back office lê e escreve a tabela. A IA chega aos anexos pelas funções
-- SECURITY DEFINER abaixo; os clientes só vêem as ligações nas respostas.
DROP POLICY IF EXISTS "Admins manage knowledge attachments" ON public.ai_knowledge_attachments;
CREATE POLICY "Admins manage knowledge attachments"
  ON public.ai_knowledge_attachments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_attachments TO service_role;

-- Excertos pesquisáveis do texto de cada anexo.
CREATE TABLE IF NOT EXISTS public.ai_knowledge_attachment_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id  uuid NOT NULL REFERENCES public.ai_knowledge_attachments(id) ON DELETE CASCADE,
  chunk_index    integer NOT NULL,
  content        text NOT NULL,
  search_vector  tsvector NOT NULL,
  UNIQUE (attachment_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_search
  ON public.ai_knowledge_attachment_chunks USING gin (search_vector);

ALTER TABLE public.ai_knowledge_attachment_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read knowledge chunks" ON public.ai_knowledge_attachment_chunks;
CREATE POLICY "Admins read knowledge chunks"
  ON public.ai_knowledge_attachment_chunks FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.ai_knowledge_attachment_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_attachment_chunks TO service_role;

-- Divide o texto em excertos de ~1500 caracteres, respeitando os parágrafos.
CREATE OR REPLACE FUNCTION public.ai_knowledge_rebuild_chunks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_para text;
  v_buf  text := '';
  v_idx  integer := 0;
  c_max  constant integer := 1500;
BEGIN
  DELETE FROM public.ai_knowledge_attachment_chunks WHERE attachment_id = NEW.id;

  IF NOT NEW.use_in_ai OR length(trim(COALESCE(NEW.content_text, ''))) = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_para IN
    SELECT trim(p)
      FROM regexp_split_to_table(replace(NEW.content_text, E'\r', ''), E'\\n\\s*\\n') AS p
  LOOP
    CONTINUE WHEN v_para = '';

    IF v_buf <> '' AND length(v_buf) + length(v_para) > c_max THEN
      INSERT INTO public.ai_knowledge_attachment_chunks (attachment_id, chunk_index, content, search_vector)
      VALUES (NEW.id, v_idx, v_buf, to_tsvector('portuguese', public.ai_knowledge_normalize(v_buf)));
      v_idx := v_idx + 1;
      v_buf := '';
    END IF;

    -- Parágrafo enorme (ex.: PDF sem linhas em branco): corta em pedaços.
    WHILE length(v_para) > c_max LOOP
      IF v_buf <> '' THEN
        INSERT INTO public.ai_knowledge_attachment_chunks (attachment_id, chunk_index, content, search_vector)
        VALUES (NEW.id, v_idx, v_buf, to_tsvector('portuguese', public.ai_knowledge_normalize(v_buf)));
        v_idx := v_idx + 1;
        v_buf := '';
      END IF;
      INSERT INTO public.ai_knowledge_attachment_chunks (attachment_id, chunk_index, content, search_vector)
      VALUES (NEW.id, v_idx, left(v_para, c_max),
              to_tsvector('portuguese', public.ai_knowledge_normalize(left(v_para, c_max))));
      v_idx := v_idx + 1;
      v_para := substr(v_para, c_max + 1);
    END LOOP;

    v_buf := CASE WHEN v_buf = '' THEN v_para ELSE v_buf || E'\n\n' || v_para END;
  END LOOP;

  IF v_buf <> '' THEN
    INSERT INTO public.ai_knowledge_attachment_chunks (attachment_id, chunk_index, content, search_vector)
    VALUES (NEW.id, v_idx, v_buf, to_tsvector('portuguese', public.ai_knowledge_normalize(v_buf)));
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER: a linha do anexo já existe quando os excertos a referenciam.
DROP TRIGGER IF EXISTS ai_knowledge_attachment_chunks_refresh ON public.ai_knowledge_attachments;
CREATE TRIGGER ai_knowledge_attachment_chunks_refresh
  AFTER INSERT OR UPDATE OF content_text, use_in_ai
  ON public.ai_knowledge_attachments
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_rebuild_chunks();

-- Bucket público dos anexos; só administradores escrevem.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('ai-knowledge', 'ai-knowledge', true, 20971520)
  ON CONFLICT (id) DO UPDATE SET public = true;

  DROP POLICY IF EXISTS "Admins upload knowledge attachments" ON storage.objects;
  CREATE POLICY "Admins upload knowledge attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'ai-knowledge' AND public.is_admin());

  DROP POLICY IF EXISTS "Admins update knowledge attachments" ON storage.objects;
  CREATE POLICY "Admins update knowledge attachments"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'ai-knowledge' AND public.is_admin());

  DROP POLICY IF EXISTS "Admins delete knowledge attachments" ON storage.objects;
  CREATE POLICY "Admins delete knowledge attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'ai-knowledge' AND public.is_admin());

  DROP POLICY IF EXISTS "Admins read knowledge attachments" ON storage.objects;
  CREATE POLICY "Admins read knowledge attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'ai-knowledge' AND public.is_admin());
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
    RAISE NOTICE 'Bucket/políticas dos anexos da base fiscal não aplicados (%). Crie o bucket público "ai-knowledge" no painel do Supabase.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Pesquisa nos anexos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_knowledge_excerpts(
  p_query text,
  p_company_id uuid,
  p_limit integer,
  p_include_drafts boolean
)
RETURNS TABLE (
  attachment_id uuid,
  article_id uuid,
  article_title text,
  article_status text,
  file_name text,
  public_url text,
  content text,
  relevancia real
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 6);
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

  -- 1.ª tentativa: todas as palavras.
  v_ts := websearch_to_tsquery('portuguese', v_norm);

  RETURN QUERY
    SELECT t.id, a.id, a.title, a.status, t.file_name, t.public_url, c.content,
           ts_rank(c.search_vector, v_ts)
      FROM public.ai_knowledge_attachment_chunks c
      JOIN public.ai_knowledge_attachments t ON t.id = c.attachment_id
      JOIN public.ai_knowledge_articles a ON a.id = t.article_id
     WHERE t.use_in_ai
       AND a.status = ANY (v_statuses)
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND c.search_vector @@ v_ts
     ORDER BY ts_rank(c.search_vector, v_ts) DESC
     LIMIT v_limit;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found > 0 THEN
    RETURN;
  END IF;

  -- 2.ª tentativa: qualquer palavra relevante, só com pelo menos duas em comum
  -- (um único termo genérico traria passagens soltas de toda a lei).
  SELECT string_agg(quote_literal(l.lexeme), ' | ')::tsquery
    INTO v_ts
    FROM unnest(to_tsvector('portuguese', v_norm)) l
   WHERE l.lexeme NOT IN ('ispc', 'facil');

  IF v_ts IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT t.id, a.id, a.title, a.status, t.file_name, t.public_url, c.content,
           ts_rank(c.search_vector, v_ts)
      FROM public.ai_knowledge_attachment_chunks c
      JOIN public.ai_knowledge_attachments t ON t.id = c.attachment_id
      JOIN public.ai_knowledge_articles a ON a.id = t.article_id
     WHERE t.use_in_ai
       AND a.status = ANY (v_statuses)
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND c.search_vector @@ v_ts
       AND (SELECT count(*)
              FROM unnest(to_tsvector('portuguese', v_norm)) q
             WHERE q.lexeme NOT IN ('ispc', 'facil')
               AND c.search_vector @@ quote_literal(q.lexeme)::tsquery) >= 2
     ORDER BY ts_rank(c.search_vector, v_ts) DESC
     LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_knowledge_excerpts(text, uuid, integer, boolean) FROM public, anon, authenticated;

-- Anexos (nome + ligação) de um artigo, para a IA os citar.
CREATE OR REPLACE FUNCTION public.ai_knowledge_article_links(p_article_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', t.file_name, 'url', t.public_url)
                            ORDER BY t.created_at), '[]'::jsonb)
    FROM public.ai_knowledge_attachments t
   WHERE t.article_id = p_article_id;
$$;

REVOKE ALL ON FUNCTION public.ai_knowledge_article_links(uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ferramenta do assistente: artigos + anexos + excertos legais
-- ---------------------------------------------------------------------------
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
  v_excerpts jsonb;
BEGIN
  IF p_company_id IS NOT NULL THEN
    PERFORM public.ai_guard(p_company_id);
  END IF;

  IF length(v_query) < 2 THEN
    RETURN jsonb_build_object('artigos', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'titulo', l.title,
             'categoria', l.category,
             'conteudo', l.body,
             'referencia_legal', l.legal_reference
           ) || CASE WHEN EXISTS (SELECT 1 FROM public.ai_knowledge_attachments t WHERE t.article_id = l.id)
                     THEN jsonb_build_object('anexos', public.ai_knowledge_article_links(l.id))
                     ELSE '{}'::jsonb END
         ORDER BY l.relevancia DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.ai_knowledge_lookup(v_query, p_company_id, p_limit, false) l;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'documento', e.file_name,
           'url', e.public_url,
           'artigo', e.article_title,
           'texto', e.content
         ) ORDER BY e.relevancia DESC), '[]'::jsonb)
    INTO v_excerpts
    FROM public.ai_knowledge_excerpts(v_query, p_company_id, 3, false) e;

  IF jsonb_array_length(v_rows) = 0 AND jsonb_array_length(v_excerpts) = 0 THEN
    INSERT INTO public.ai_knowledge_gaps (query, query_norm, company_id, user_id)
    VALUES (left(v_query, 500),
            left(public.ai_knowledge_normalize(v_query), 500),
            p_company_id,
            auth.uid());
  END IF;

  RETURN jsonb_build_object('consulta', v_query, 'artigos', v_rows)
         || CASE WHEN jsonb_array_length(v_excerpts) > 0
                 THEN jsonb_build_object('excertos_legais', v_excerpts)
                 ELSE '{}'::jsonb END;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_search_knowledge(text, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_search_knowledge(text, uuid, integer) TO authenticated;

-- Painel "Testar pergunta": excertos dos anexos que o assistente receberia.
CREATE OR REPLACE FUNCTION public.ai_admin_test_knowledge_excerpts(
  p_query text,
  p_include_drafts boolean DEFAULT true,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 3
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
             'attachment_id', e.attachment_id,
             'article_id', e.article_id,
             'article_title', e.article_title,
             'article_status', e.article_status,
             'file_name', e.file_name,
             'public_url', e.public_url,
             'content', e.content,
             'relevancia', round(e.relevancia::numeric, 4)
           ) ORDER BY e.relevancia DESC), '[]'::jsonb)
      FROM public.ai_knowledge_excerpts(p_query, p_company_id, p_limit, p_include_drafts) e
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_admin_test_knowledge_excerpts(text, boolean, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_admin_test_knowledge_excerpts(text, boolean, uuid, integer) TO authenticated;
