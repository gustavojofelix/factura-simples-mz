-- Assistente Virtual (IA) — funções analíticas
--
-- Esta é a superfície de ferramentas que o modelo pode invocar. Nenhuma delas
-- escreve. Todas são SECURITY DEFINER com verificação explícita de acesso, e
-- são chamadas com o JWT do utilizador: o modelo nunca consegue ler dados que o
-- próprio utilizador não conseguiria ler pela aplicação.
--
-- Convenção de negócio partilhada por todas as funções:
--   "factura emitida" = status NOT IN ('rascunho', 'anulada')
--   "venda"           = total de facturas emitidas
-- Rascunhos ainda não existem fiscalmente e anuladas foram revertidas; contá-las
-- inflacionaria todas as respostas do assistente.

CREATE OR REPLACE FUNCTION public.ai_guard(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR NOT public.ai_can_access_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso aos dados desta empresa.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Retrato da empresa — contexto inicial de qualquer conversa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_company_snapshot(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  SELECT jsonb_build_object(
    'empresa', c.name,
    'nuit', c.nuit,
    'moeda', COALESCE(c.currency, 'MZN'),
    'data_de_hoje', CURRENT_DATE,
    'clientes_activos', (SELECT count(*) FROM public.clients cl
                          WHERE cl.company_id = c.id AND COALESCE(cl.is_active, true)),
    'produtos_activos', (SELECT count(*) FROM public.products p
                          WHERE p.company_id = c.id AND COALESCE(p.is_active, true)),
    'facturas_emitidas_total', (SELECT count(*) FROM public.invoices i
                                 WHERE i.company_id = c.id
                                   AND i.status NOT IN ('rascunho', 'anulada')),
    'primeira_factura', (SELECT min(i.date) FROM public.invoices i
                          WHERE i.company_id = c.id AND i.status NOT IN ('rascunho', 'anulada')),
    'ultima_factura', (SELECT max(i.date) FROM public.invoices i
                        WHERE i.company_id = c.id AND i.status NOT IN ('rascunho', 'anulada'))
  )
  INTO v_result
  FROM public.companies c
  WHERE c.id = p_company_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Estatísticas de facturação num período
--    Responde a "quantas facturas emiti este mês?" e "quanto vendi ontem?"
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_invoice_stats(
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
  v_from date := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  v_to   date := COALESCE(p_to, CURRENT_DATE);
  v_result jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'facturas_emitidas', count(*) FILTER (WHERE status NOT IN ('rascunho', 'anulada')),
    'total_vendido', COALESCE(sum(total) FILTER (WHERE status NOT IN ('rascunho', 'anulada')), 0),
    'total_recebido', COALESCE(sum(amount_paid) FILTER (WHERE status NOT IN ('rascunho', 'anulada')), 0),
    'total_por_receber', COALESCE(sum(amount_pending) FILTER (WHERE status NOT IN ('rascunho', 'anulada')), 0),
    'ticket_medio', ROUND(COALESCE(
      avg(total) FILTER (WHERE status NOT IN ('rascunho', 'anulada')), 0), 2),
    'por_estado', jsonb_build_object(
      'rascunho', count(*) FILTER (WHERE status = 'rascunho'),
      'pendente', count(*) FILTER (WHERE status = 'pendente'),
      'paga',     count(*) FILTER (WHERE status = 'paga'),
      'vencida',  count(*) FILTER (WHERE status = 'vencida'),
      'anulada',  count(*) FILTER (WHERE status = 'anulada')
    )
  )
  INTO v_result
  FROM public.invoices
  WHERE company_id = p_company_id
    AND date BETWEEN v_from AND v_to;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Série temporal de vendas — base dos gráficos e dos relatórios
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_sales_timeseries(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_granularity text DEFAULT 'month'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := COALESCE(p_from, (CURRENT_DATE - interval '11 months')::date);
  v_to   date := COALESCE(p_to, CURRENT_DATE);
  v_gran text := lower(COALESCE(p_granularity, 'month'));
  v_rows jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  IF v_gran NOT IN ('day', 'week', 'month', 'quarter', 'year') THEN
    v_gran := 'month';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'periodo'), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'periodo', to_char(date_trunc(v_gran, i.date), 'YYYY-MM-DD'),
      'facturas', count(*),
      'total_vendido', COALESCE(sum(i.total), 0),
      'total_recebido', COALESCE(sum(i.amount_paid), 0)
    ) AS t
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.status NOT IN ('rascunho', 'anulada')
      AND i.date BETWEEN v_from AND v_to
    GROUP BY date_trunc(v_gran, i.date)
  ) s;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'granularidade', v_gran,
    'series', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Produtos mais vendidos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_top_products(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_metric text DEFAULT 'receita',
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := COALESCE(p_from, (CURRENT_DATE - interval '12 months')::date);
  v_to   date := COALESCE(p_to, CURRENT_DATE);
  v_metric text := CASE WHEN lower(COALESCE(p_metric, 'receita')) IN ('quantidade', 'quantity')
                        THEN 'quantidade' ELSE 'receita' END;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_rows jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  -- Agrupa por produto quando existe ligação, e pela descrição da linha quando
  -- o item foi escrito à mão na factura. Sem isto, itens avulsos desapareciam
  -- do ranking e o "mais vendido" ficaria errado.
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'produto', COALESCE(max(p.name), max(it.description)),
      'tipo', max(p.type),
      'quantidade_vendida', ROUND(sum(it.quantity), 2),
      'receita', ROUND(sum(it.total), 2),
      'numero_de_facturas', count(DISTINCT it.invoice_id)
    ) AS t
    FROM public.invoice_items it
    JOIN public.invoices i ON i.id = it.invoice_id
    LEFT JOIN public.products p ON p.id = it.product_id
    WHERE i.company_id = p_company_id
      AND i.status NOT IN ('rascunho', 'anulada')
      AND i.date BETWEEN v_from AND v_to
    GROUP BY COALESCE(it.product_id::text, lower(trim(it.description)))
    ORDER BY
      CASE WHEN v_metric = 'quantidade' THEN sum(it.quantity) ELSE sum(it.total) END DESC
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'ordenado_por', v_metric,
    'produtos', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Melhores clientes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_top_clients(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := COALESCE(p_from, (CURRENT_DATE - interval '12 months')::date);
  v_to   date := COALESCE(p_to, CURRENT_DATE);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_rows jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'cliente', c.name,
      'nuit', c.nuit,
      'facturas', count(*),
      'total_facturado', ROUND(sum(i.total), 2),
      'total_por_receber', ROUND(sum(i.amount_pending), 2),
      'ultima_compra', max(i.date)
    ) AS t
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    WHERE i.company_id = p_company_id
      AND i.status NOT IN ('rascunho', 'anulada')
      AND i.date BETWEEN v_from AND v_to
    GROUP BY c.id, c.name, c.nuit
    ORDER BY sum(i.total) DESC
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'clientes', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Clientes inactivos — "quais clientes deixaram de comprar?"
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_inactive_clients(
  p_company_id uuid,
  p_days integer DEFAULT 90,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 1), 3650);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_cutoff date := CURRENT_DATE - v_days;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  -- Só entram clientes que já compraram alguma vez: um cliente registado que
  -- nunca facturou não "deixou de usar", nunca começou.
  WITH ultima_compra AS (
    SELECT c.id, c.name, c.nuit, c.phone, c.email,
           max(i.date) AS ultima,
           count(i.id) AS total_facturas,
           COALESCE(sum(i.total), 0) AS total_historico
      FROM public.clients c
      JOIN public.invoices i
        ON i.client_id = c.id
       AND i.status NOT IN ('rascunho', 'anulada')
     WHERE c.company_id = p_company_id
     GROUP BY c.id, c.name, c.nuit, c.phone, c.email
    HAVING max(i.date) < v_cutoff
  )
  SELECT count(*),
         COALESCE(jsonb_agg(t ORDER BY (t->>'total_historico')::numeric DESC)
                  FILTER (WHERE rn <= v_limit), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (
    SELECT jsonb_build_object(
             'cliente', name,
             'nuit', nuit,
             'telefone', phone,
             'email', email,
             'ultima_compra', ultima,
             'dias_sem_comprar', (CURRENT_DATE - ultima),
             'facturas_historicas', total_facturas,
             'total_historico', ROUND(total_historico, 2)
           ) AS t,
           row_number() OVER (ORDER BY total_historico DESC) AS rn
      FROM ultima_compra
  ) s;

  RETURN jsonb_build_object(
    'criterio', format('sem qualquer factura emitida desde %s (%s dias)', v_cutoff, v_days),
    'total_de_clientes_inactivos', COALESCE(v_total, 0),
    'clientes', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Contas a receber — "qual é o total pendente por receber?"
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_receivables(
  p_company_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_totais jsonb;
  v_devedores jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  -- Antiguidade medida a partir da data de vencimento; quando a factura não tem
  -- vencimento definido, usa-se a data de emissão.
  SELECT jsonb_build_object(
    'total_por_receber', ROUND(COALESCE(sum(amount_pending), 0), 2),
    'facturas_em_aberto', count(*),
    'antiguidade', jsonb_build_object(
      'a_vencer',      ROUND(COALESCE(sum(amount_pending) FILTER (WHERE COALESCE(due_date, date) >= CURRENT_DATE), 0), 2),
      'vencido_1_30',  ROUND(COALESCE(sum(amount_pending) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, date) BETWEEN 1 AND 30), 0), 2),
      'vencido_31_60', ROUND(COALESCE(sum(amount_pending) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, date) BETWEEN 31 AND 60), 0), 2),
      'vencido_61_90', ROUND(COALESCE(sum(amount_pending) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, date) BETWEEN 61 AND 90), 0), 2),
      'vencido_90_mais', ROUND(COALESCE(sum(amount_pending) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, date) > 90), 0), 2)
    )
  )
  INTO v_totais
  FROM public.invoices
  WHERE company_id = p_company_id
    AND status IN ('pendente', 'vencida')
    AND amount_pending > 0;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
  INTO v_devedores
  FROM (
    SELECT jsonb_build_object(
      'cliente', c.name,
      'telefone', c.phone,
      'facturas_em_aberto', count(*),
      'valor_por_receber', ROUND(sum(i.amount_pending), 2),
      'factura_mais_antiga', min(i.date),
      'dias_de_atraso_maximo', max(GREATEST(CURRENT_DATE - COALESCE(i.due_date, i.date), 0))
    ) AS t
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    WHERE i.company_id = p_company_id
      AND i.status IN ('pendente', 'vencida')
      AND i.amount_pending > 0
    GROUP BY c.id, c.name, c.phone
    ORDER BY sum(i.amount_pending) DESC
    LIMIT v_limit
  ) s;

  RETURN COALESCE(v_totais, '{}'::jsonb) || jsonb_build_object('principais_devedores', v_devedores);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Posição fiscal — declarações de ISPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_tax_position(
  p_company_id uuid,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_rows jsonb;
  v_proxima jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'trimestre'), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'trimestre', d.period,
      'ano', d.year,
      'de', d.start_date,
      'ate', d.end_date,
      'vendas_do_periodo', ROUND(d.total_sales, 2),
      'base_ispc', ROUND(d.ispc_base, 2),
      'taxa', d.ispc_rate,
      'ispc_a_pagar', ROUND(d.ispc_amount, 2),
      'estado', d.status,
      'data_limite', d.due_date,
      'data_submissao', d.submission_date,
      'data_pagamento', d.payment_date
    ) AS t
    FROM public.tax_declarations d
    WHERE d.company_id = p_company_id AND d.year = v_year
  ) s;

  SELECT jsonb_build_object(
    'trimestre', d.period,
    'ano', d.year,
    'data_limite', d.due_date,
    'dias_restantes', d.due_date - CURRENT_DATE,
    'valor', ROUND(d.ispc_amount, 2),
    'estado', d.status
  )
  INTO v_proxima
  FROM public.tax_declarations d
  WHERE d.company_id = p_company_id
    AND d.status IN ('pendente', 'submetida', 'atrasada')
    AND d.due_date IS NOT NULL
  ORDER BY d.due_date ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ano', v_year,
    'declaracoes', v_rows,
    'proxima_obrigacao', v_proxima
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Listagem de facturas com filtros — usada nos relatórios e no detalhe
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_list_invoices(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  SELECT count(*) INTO v_total
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
   WHERE i.company_id = p_company_id
     AND (p_from IS NULL OR i.date >= p_from)
     AND (p_to IS NULL OR i.date <= p_to)
     AND (p_status IS NULL OR i.status = lower(p_status))
     AND (p_client_name IS NULL OR c.name ILIKE '%' || p_client_name || '%');

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'numero', i.invoice_number,
      'data', i.date,
      'vencimento', i.due_date,
      'cliente', c.name,
      'subtotal', ROUND(i.subtotal, 2),
      'total', ROUND(i.total, 2),
      'pago', ROUND(i.amount_paid, 2),
      'por_receber', ROUND(i.amount_pending, 2),
      'estado', i.status
    ) AS t
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    WHERE i.company_id = p_company_id
      AND (p_from IS NULL OR i.date >= p_from)
      AND (p_to IS NULL OR i.date <= p_to)
      AND (p_status IS NULL OR i.status = lower(p_status))
      AND (p_client_name IS NULL OR c.name ILIKE '%' || p_client_name || '%')
    ORDER BY i.date DESC, i.created_at DESC
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'total_de_resultados', v_total,
    'devolvidos', jsonb_array_length(v_rows),
    'facturas', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Pesquisa inteligente — uma consulta, todas as entidades
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_search(
  p_company_id uuid,
  p_query text,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
  v_q text := '%' || trim(COALESCE(p_query, '')) || '%';
  v_clientes jsonb;
  v_produtos jsonb;
  v_facturas jsonb;
BEGIN
  PERFORM public.ai_guard(p_company_id);

  IF length(trim(COALESCE(p_query, ''))) < 2 THEN
    RETURN jsonb_build_object('erro', 'A pesquisa precisa de pelo menos 2 caracteres.');
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_clientes
  FROM (
    SELECT jsonb_build_object(
      'tipo', 'cliente', 'id', c.id, 'titulo', c.name,
      'subtitulo', COALESCE('NUIT ' || c.nuit, c.email, c.phone, ''),
      'rota', '/clientes'
    ) AS t
    FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (c.name ILIKE v_q OR c.nuit ILIKE v_q OR c.email ILIKE v_q OR c.phone ILIKE v_q)
    ORDER BY c.name
    LIMIT v_limit
  ) s;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_produtos
  FROM (
    SELECT jsonb_build_object(
      'tipo', 'produto', 'id', p.id, 'titulo', p.name,
      'subtitulo', COALESCE(p.description, p.type, ''),
      'preco', ROUND(p.price, 2),
      'rota', '/produtos'
    ) AS t
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.name ILIKE v_q OR p.description ILIKE v_q)
    ORDER BY p.name
    LIMIT v_limit
  ) s;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_facturas
  FROM (
    SELECT jsonb_build_object(
      'tipo', 'factura', 'id', i.id, 'titulo', i.invoice_number,
      'subtitulo', c.name || ' · ' || to_char(i.date, 'DD/MM/YYYY'),
      'total', ROUND(i.total, 2),
      'estado', i.status,
      'rota', '/facturas/' || i.id
    ) AS t
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    WHERE i.company_id = p_company_id
      AND (i.invoice_number ILIKE v_q OR c.name ILIKE v_q OR i.notes ILIKE v_q)
    ORDER BY i.date DESC
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'consulta', trim(p_query),
    'clientes', v_clientes,
    'produtos', v_produtos,
    'facturas', v_facturas
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Índices de apoio às pesquisas por texto
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
    ON public.clients USING gin (name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON public.products USING gin (name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_invoices_number_trgm
    ON public.invoices USING gin (invoice_number gin_trgm_ops);
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  -- Sem pg_trgm as pesquisas continuam a funcionar por ILIKE, apenas mais lentas.
  RAISE NOTICE 'pg_trgm indisponível; a pesquisa usará varrimento sequencial.';
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_company_date
  ON public.invoices (company_id, date DESC) WHERE status <> 'rascunho';
CREATE INDEX IF NOT EXISTS idx_invoices_company_pending
  ON public.invoices (company_id, amount_pending) WHERE amount_pending > 0;

-- ---------------------------------------------------------------------------
-- Permissões: leitura apenas, e sempre no contexto do utilizador autenticado
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.ai_guard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_company_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_invoice_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_sales_timeseries(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_top_products(uuid, date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_top_clients(uuid, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_inactive_clients(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_receivables(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tax_position(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_list_invoices(uuid, date, date, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_search(uuid, text, integer) TO authenticated;
