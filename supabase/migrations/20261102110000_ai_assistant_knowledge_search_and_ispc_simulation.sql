-- Assistente Virtual: perguntas que ficavam sem resposta
--
--  1. Pesquisa na base fiscal mais tolerante. websearch_to_tsquery exige que
--     TODAS as palavras da pergunta existam no artigo: "Quais são as
--     actividades elegíveis ao ISPC Fácil?" não encontrava nada porque nenhum
--     artigo tem "elegível" e "fácil" ao mesmo tempo. Agora:
--       - a pesquisa ignora acentos (elegiveis = elegíveis);
--       - aceita a grafia do Acordo Ortográfico (atividade = actividade,
--         fatura = factura);
--       - se a pesquisa estrita não devolver nada, repete com qualquer uma das
--         palavras (OR), ordenada por relevância.
--
--  2. Variantes de pergunta nos artigos existentes (actividades elegíveis,
--     escalão actual), sem alterar o conteúdo fiscal revisto.
--
--  3. ai_simulate_ispc: simula o ISPC de um período até hoje ("se o trimestre
--     terminasse agora, quanto pagaria?"), com as mesmas regras do Modelo 30
--     (calculate_ispc_split e a taxa da actividade da empresa).

-- ---------------------------------------------------------------------------
-- 1. Pesquisa
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Normaliza texto para pesquisa: sem acentos, minúsculas e grafia pré-AO90
-- (a dos artigos).
CREATE OR REPLACE FUNCTION public.ai_knowledge_normalize(p_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(extensions.unaccent(COALESCE(p_text, ''))),
                            '\mfatur', 'factur', 'g'),
             '\mativ', 'activ', 'g'),
           '\matua', 'actua', 'g');
$$;

CREATE OR REPLACE FUNCTION public.ai_knowledge_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', public.ai_knowledge_normalize(NEW.title)), 'A') ||
    setweight(to_tsvector('portuguese',
              public.ai_knowledge_normalize(array_to_string(NEW.question_variants, ' '))), 'A') ||
    setweight(to_tsvector('portuguese', public.ai_knowledge_normalize(NEW.body)), 'B');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_search_knowledge(
  p_query text,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10);
  v_query text := trim(COALESCE(p_query, ''));
  v_norm text;
  v_ts tsquery;
  v_rows jsonb;
BEGIN
  IF p_company_id IS NOT NULL THEN
    PERFORM public.ai_guard(p_company_id);
  END IF;

  IF length(v_query) < 2 THEN
    RETURN jsonb_build_object('artigos', '[]'::jsonb);
  END IF;

  v_norm := public.ai_knowledge_normalize(v_query);

  -- 1.ª tentativa: todas as palavras (mais precisa).
  v_ts := websearch_to_tsquery('portuguese', v_norm);
  v_rows := public.ai_search_knowledge_rows(v_ts, v_norm, p_company_id, v_limit);

  -- 2.ª tentativa: qualquer palavra relevante, ordenada por relevância.
  IF jsonb_array_length(v_rows) = 0 THEN
    -- Os lexemas já vêm normalizados: o cast directo evita reprocessá-los.
    SELECT string_agg(quote_literal(l.lexeme), ' | ')::tsquery
      INTO v_ts
      FROM unnest(to_tsvector('portuguese', v_norm)) l
     WHERE l.lexeme NOT IN ('ispc', 'facil');  -- presentes em quase todos os artigos
    IF v_ts IS NOT NULL THEN
      v_rows := public.ai_search_knowledge_rows(v_ts, v_norm, p_company_id, v_limit);
    END IF;
  END IF;

  RETURN jsonb_build_object('consulta', v_query, 'artigos', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_search_knowledge_rows(
  p_ts tsquery,
  p_norm text,
  p_company_id uuid,
  p_limit integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(jsonb_agg(s.t ORDER BY s.relevancia DESC, s.sort_order), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'titulo', a.title,
               'categoria', a.category,
               'conteudo', a.body,
               'referencia_legal', a.legal_reference
             ) AS t,
             ts_rank(a.search_vector, p_ts) AS relevancia,
             a.sort_order
        FROM public.ai_knowledge_articles a
       WHERE a.status = 'publicado'
         AND (a.company_id IS NULL OR a.company_id = p_company_id)
         AND (a.search_vector @@ p_ts
              OR public.ai_knowledge_normalize(a.title) LIKE '%' || p_norm || '%')
       ORDER BY ts_rank(a.search_vector, p_ts) DESC, a.sort_order
       LIMIT p_limit
    ) s;
$$;

REVOKE ALL ON FUNCTION public.ai_search_knowledge_rows(tsquery, text, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_search_knowledge(text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Variantes de pergunta (o trigger refaz o vector de pesquisa)
-- ---------------------------------------------------------------------------

UPDATE public.ai_knowledge_articles
   SET question_variants = question_variants || ARRAY[
         'actividades elegíveis ao ispc', 'que actividades podem aderir ao ispc',
         'actividades abrangidas pelo ispc', 'a minha actividade pode ser ispc',
         'quem pode usar o ispc fácil', 'condições de adesão ao ispc']
 WHERE slug = 'quem-esta-sujeito-ao-ispc'
   AND NOT ('actividades elegíveis ao ispc' = ANY (question_variants));

UPDATE public.ai_knowledge_articles
   SET question_variants = question_variants || ARRAY[
         'em que escalão estou', 'qual a taxa que vou pagar', 'taxa de ispc actual',
         'quanto pagaria de ispc', 'taxa efectiva do ispc']
 WHERE slug = 'como-calcular-o-ispc'
   AND NOT ('em que escalão estou' = ANY (question_variants));

-- Linhas não abrangidas pelos UPDATEs acima também passam a ter o vector
-- normalizado.
UPDATE public.ai_knowledge_articles SET title = title;

-- ---------------------------------------------------------------------------
-- 3. Simulação do ISPC até hoje
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_simulate_ispc(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to date := LEAST(COALESCE(p_to, CURRENT_DATE), CURRENT_DATE);
  v_from date := COALESCE(p_from, date_trunc('quarter', v_to::timestamp)::date);
  v_company record;
  v_role text;
  v_rule_rate numeric;
  v_base_rate integer;
  v_is_scale boolean;
  v_sales numeric(14,2);
  v_before numeric(14,2);
  v_accum numeric(14,2);
  v_split record;
  v_marginal integer;
  v_r3 integer;
  v_r4 integer;
  v_r5 integer;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  IF v_from > v_to THEN
    RAISE EXCEPTION 'Período inválido: o início é posterior ao fim.';
  END IF;
  IF EXTRACT(YEAR FROM v_from) <> EXTRACT(YEAR FROM v_to) THEN
    RAISE EXCEPTION 'O período tem de estar dentro do mesmo ano civil (os escalões são anuais).';
  END IF;

  SELECT c.category2, c.business_volume INTO v_company
    FROM public.companies c WHERE c.id = p_company_id;

  -- Mesma regra que a aplicação usa no Modelo 30 (TaxService.getRateConfig):
  -- actividade de serviço, senão a principal, senão a primeira.
  SELECT ca.activity_role, r.tax_rate INTO v_role, v_rule_rate
    FROM public.company_activities ca
    LEFT JOIN public.activity_type_rules r
      ON r.activity_type_id = ca.activity_type_id
     AND r.is_active AND r.rule_type = 'ispc_rate'
   WHERE ca.company_id = p_company_id
   ORDER BY (ca.activity_role = 'servico') DESC, ca.is_primary DESC, ca.created_at
   LIMIT 1;

  IF v_rule_rate IS NOT NULL THEN
    v_base_rate := v_rule_rate::integer;
    v_is_scale := NOT (v_role = 'servico'
                       OR v_company.category2 IN ('servicos_nao_liberais', 'servicos_liberais')
                       OR v_base_rate IN (12, 15));
  ELSE
    v_base_rate := CASE v_company.category2
                     WHEN 'servicos_nao_liberais' THEN 12
                     WHEN 'servicos_liberais' THEN 15
                     ELSE COALESCE(NULLIF(regexp_replace(COALESCE(v_company.business_volume, ''), '\D', '', 'g'), '')::integer, 3)
                   END;
    v_is_scale := COALESCE(v_company.category2, '') NOT IN ('servicos_nao_liberais', 'servicos_liberais');
  END IF;

  SELECT COALESCE(SUM(i.total), 0) INTO v_sales
    FROM public.invoices i
   WHERE i.company_id = p_company_id
     AND i.status NOT IN ('rascunho', 'anulada')
     AND i.date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(i.total), 0) INTO v_before
    FROM public.invoices i
   WHERE i.company_id = p_company_id
     AND i.status NOT IN ('rascunho', 'anulada')
     AND i.date >= make_date(EXTRACT(YEAR FROM v_from)::integer, 1, 1)
     AND i.date < v_from;

  v_accum := v_before + v_sales;

  SELECT * INTO v_split FROM public.calculate_ispc_split(v_sales, v_before, v_base_rate);

  v_r3 := CASE WHEN v_base_rate IN (12, 15) THEN v_base_rate ELSE 3 END;
  v_r4 := CASE WHEN v_base_rate IN (12, 15) THEN v_base_rate ELSE 4 END;
  v_r5 := CASE WHEN v_base_rate IN (12, 15) THEN v_base_rate ELSE 5 END;

  v_marginal := CASE
                  WHEN v_accum > 4000000 THEN 20
                  WHEN v_accum > 2500000 THEN v_r5
                  WHEN v_accum > 1000000 THEN v_r4
                  ELSE v_r3
                END;

  RETURN jsonb_build_object(
    'simulacao', true,
    'de', v_from,
    'ate', v_to,
    'tipo_actividade', CASE WHEN v_is_scale THEN 'actividade de escala (escalões 3/4/5/20%)'
                            ELSE format('prestação de serviços (taxa única %s%%, 20%% acima de 4.000.000 MT)', v_base_rate) END,
    'vendas_do_periodo', ROUND(v_sales, 2),
    'vendas_do_ano_antes_do_periodo', ROUND(v_before, 2),
    'vendas_acumuladas_no_ano', ROUND(v_accum, 2),
    'ispc_do_periodo', ROUND(COALESCE(v_split.total_tax, 0), 2),
    'taxa_efectiva_do_periodo_pct', CASE WHEN v_sales > 0
                                         THEN ROUND(v_split.total_tax / v_sales * 100, 2) END,
    'taxa_do_escalao_actual_pct', v_marginal,
    'base_por_taxa', jsonb_strip_nulls(jsonb_build_object(
       v_r3 || '%', NULLIF(ROUND(v_split.portion_3pct, 2), 0),
       CASE WHEN v_r4 = v_r3 THEN v_r4 || '% (2)' ELSE v_r4 || '%' END, NULLIF(ROUND(v_split.portion_4pct, 2), 0),
       CASE WHEN v_r5 = v_r3 THEN v_r5 || '% (3)' ELSE v_r5 || '%' END, NULLIF(ROUND(v_split.portion_5pct, 2), 0),
       '20%', NULLIF(ROUND(v_split.portion_20pct, 2), 0))),
    'nota', 'Simulação com as facturas emitidas até à data indicada; não é uma declaração. '
         || 'O ISPC declara-se por trimestre (Modelo 30) e os escalões acumulam ao longo do ano civil.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_simulate_ispc(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_simulate_ispc(uuid, date, date) TO authenticated;
