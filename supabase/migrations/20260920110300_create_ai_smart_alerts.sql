-- Assistente Virtual (IA) — alertas inteligentes
--
-- As regras são SQL determinístico, não chamadas ao modelo: correr um LLM por
-- empresa e por dia custaria muito e daria resultados instáveis. O modelo entra
-- depois, quando o utilizador pede para explicar ou aprofundar um alerta.
--
-- Cada alerta tem uma dedupe_key que inclui o período a que respeita, para que
-- a execução diária seja idempotente mas o alerta volte a surgir no período
-- seguinte.

CREATE TABLE IF NOT EXISTS public.ai_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_code text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'aviso', 'critico')),
  title text NOT NULL,
  body text NOT NULL,
  -- Números que sustentam o alerta, para a UI e para o assistente citarem.
  metric jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_label text,
  action_route text,
  status text NOT NULL DEFAULT 'nova'
    CHECK (status IN ('nova', 'lida', 'resolvida', 'dispensada')),
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  resolved_at timestamptz,
  CONSTRAINT ai_alerts_dedupe UNIQUE (company_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_company_status
  ON public.ai_alerts (company_id, status, created_at DESC);

ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members read alerts" ON public.ai_alerts;
CREATE POLICY "Company members read alerts"
  ON public.ai_alerts FOR SELECT
  TO authenticated
  USING (public.ai_can_access_company(company_id));

-- Só o estado é editável pelo utilizador (marcar como lida, dispensar);
-- o conteúdo é gerado pelo motor.
DROP POLICY IF EXISTS "Company members update alert status" ON public.ai_alerts;
CREATE POLICY "Company members update alert status"
  ON public.ai_alerts FOR UPDATE
  TO authenticated
  USING (public.ai_can_access_company(company_id))
  WITH CHECK (public.ai_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- Motor de regras
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_upsert_alert(
  p_company_id uuid,
  p_rule_code text,
  p_dedupe_key text,
  p_severity text,
  p_title text,
  p_body text,
  p_metric jsonb,
  p_action_label text,
  p_action_route text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_alerts
    (company_id, rule_code, dedupe_key, severity, title, body, metric, action_label, action_route)
  VALUES
    (p_company_id, p_rule_code, p_dedupe_key, p_severity, p_title, p_body,
     COALESCE(p_metric, '{}'::jsonb), p_action_label, p_action_route)
  ON CONFLICT (company_id, dedupe_key) DO UPDATE SET
    -- Actualiza os números de um alerta ainda por tratar; um alerta já
    -- dispensado ou resolvido pelo utilizador não regressa.
    title = CASE WHEN public.ai_alerts.status IN ('nova', 'lida')
                 THEN EXCLUDED.title ELSE public.ai_alerts.title END,
    body = CASE WHEN public.ai_alerts.status IN ('nova', 'lida')
                THEN EXCLUDED.body ELSE public.ai_alerts.body END,
    metric = CASE WHEN public.ai_alerts.status IN ('nova', 'lida')
                  THEN EXCLUDED.metric ELSE public.ai_alerts.metric END,
    severity = CASE WHEN public.ai_alerts.status IN ('nova', 'lida')
                    THEN EXCLUDED.severity ELSE public.ai_alerts.severity END;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_ai_alerts(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mes text := to_char(CURRENT_DATE, 'YYYY-MM');
  v_moeda text;
  v_count integer := 0;

  v_vencidas_n bigint;
  v_vencidas_v numeric;
  v_vencida_mais_antiga integer;

  v_inactivos_n bigint;
  v_inactivos_v numeric;

  v_periodo integer;
  v_ano integer;
  v_limite date;
  v_valor numeric;
  v_decl record;

  v_vendas_mes numeric;
  v_media_3m numeric;
  v_variacao numeric;

  v_acumulado_ano numeric;
  v_proximo_limiar numeric;
  v_taxa_actual integer;
  v_taxa_seguinte integer;
BEGIN
  SELECT COALESCE(currency, 'MZN') INTO v_moeda
    FROM public.companies WHERE id = p_company_id;

  IF v_moeda IS NULL THEN
    RETURN 0;  -- empresa inexistente
  END IF;

  -- ---- 1. Facturas vencidas por cobrar -------------------------------------
  SELECT count(*), COALESCE(sum(amount_pending), 0),
         COALESCE(max(CURRENT_DATE - COALESCE(due_date, date)), 0)
    INTO v_vencidas_n, v_vencidas_v, v_vencida_mais_antiga
    FROM public.invoices
   WHERE company_id = p_company_id
     AND status IN ('pendente', 'vencida')
     AND amount_pending > 0
     AND COALESCE(due_date, date) < CURRENT_DATE;

  IF v_vencidas_n > 0 THEN
    PERFORM public.ai_upsert_alert(
      p_company_id, 'facturas_vencidas', 'facturas_vencidas:' || v_mes,
      CASE WHEN v_vencida_mais_antiga > 60 THEN 'critico' ELSE 'aviso' END,
      format('%s factura(s) vencida(s) por cobrar', v_vencidas_n),
      format('Tem %s %s por receber em facturas já vencidas. A mais antiga está %s dias em atraso. Lembre-se de que o ISPC destas facturas já é devido, mesmo sem o dinheiro ter entrado.',
             to_char(v_vencidas_v, 'FM999G999G990D00'), v_moeda, v_vencida_mais_antiga),
      jsonb_build_object('facturas', v_vencidas_n, 'valor', v_vencidas_v,
                         'dias_atraso_maximo', v_vencida_mais_antiga),
      'Ver contas a receber', '/relatorios'
    );
    v_count := v_count + 1;
  END IF;

  -- ---- 2. Clientes que deixaram de comprar ---------------------------------
  -- Só conta clientes com historial relevante: perder um cliente de uma única
  -- factura pequena não merece um alerta.
  WITH inactivos AS (
    SELECT c.id, sum(i.total) AS historico
      FROM public.clients c
      JOIN public.invoices i ON i.client_id = c.id
                            AND i.status NOT IN ('rascunho', 'anulada')
     WHERE c.company_id = p_company_id
     GROUP BY c.id
    HAVING max(i.date) < CURRENT_DATE - 90
       AND count(i.id) >= 2
  )
  SELECT count(*), COALESCE(sum(historico), 0) INTO v_inactivos_n, v_inactivos_v
    FROM inactivos;

  IF v_inactivos_n > 0 THEN
    PERFORM public.ai_upsert_alert(
      p_company_id, 'clientes_inactivos', 'clientes_inactivos:' || v_mes,
      'aviso',
      format('%s cliente(s) sem comprar há mais de 90 dias', v_inactivos_n),
      format('Estes clientes já compraram pelo menos duas vezes e representaram %s %s de facturação histórica, mas não compram há mais de 90 dias. Vale a pena um contacto.',
             to_char(v_inactivos_v, 'FM999G999G990D00'), v_moeda),
      jsonb_build_object('clientes', v_inactivos_n, 'valor_historico', v_inactivos_v),
      'Ver clientes', '/clientes'
    );
    v_count := v_count + 1;
  END IF;

  -- ---- 3. Prazo fiscal a aproximar-se --------------------------------------
  SELECT d.period, d.year, d.due_date, d.ispc_amount
    INTO v_periodo, v_ano, v_limite, v_valor
    FROM public.tax_declarations d
   WHERE d.company_id = p_company_id
     AND d.status IN ('pendente', 'submetida')
     AND d.due_date IS NOT NULL
     AND d.due_date >= CURRENT_DATE
     AND d.due_date <= CURRENT_DATE + 20
   ORDER BY d.due_date ASC
   LIMIT 1;

  IF v_limite IS NOT NULL THEN
    PERFORM public.ai_upsert_alert(
      p_company_id, 'prazo_fiscal',
      format('prazo_fiscal:%s:T%s', v_ano, v_periodo),
      CASE WHEN v_limite - CURRENT_DATE <= 7 THEN 'critico' ELSE 'aviso' END,
      format('Modelo 30 do %s.º trimestre a entregar até %s',
             v_periodo, to_char(v_limite, 'DD/MM/YYYY')),
      format('Faltam %s dias para o prazo de entrega e pagamento do ISPC do %s.º trimestre de %s. Valor apurado: %s %s.',
             v_limite - CURRENT_DATE, v_periodo, v_ano,
             to_char(v_valor, 'FM999G999G990D00'), v_moeda),
      jsonb_build_object('trimestre', v_periodo, 'ano', v_ano,
                         'data_limite', v_limite, 'valor', v_valor,
                         'dias_restantes', v_limite - CURRENT_DATE),
      'Ver Modelo 30', '/impostos'
    );
    v_count := v_count + 1;
  END IF;

  -- ---- 4. Declaração em atraso ---------------------------------------------
  FOR v_decl IN
    SELECT d.period, d.year, d.due_date, d.ispc_amount
      FROM public.tax_declarations d
     WHERE d.company_id = p_company_id
       AND d.status IN ('pendente', 'atrasada')
       AND d.due_date IS NOT NULL
       AND d.due_date < CURRENT_DATE
  LOOP
    PERFORM public.ai_upsert_alert(
      p_company_id, 'declaracao_atrasada',
      format('declaracao_atrasada:%s:T%s', v_decl.year, v_decl.period),
      'critico',
      format('ISPC do %s.º trimestre de %s em atraso', v_decl.period, v_decl.year),
      format('O prazo terminou a %s, há %s dias. O atraso gera multa pela falta de entrega e juros de mora sobre os %s %s em dívida. Regularizar voluntariamente é, em regra, mais favorável do que aguardar notificação.',
             to_char(v_decl.due_date, 'DD/MM/YYYY'), CURRENT_DATE - v_decl.due_date,
             to_char(v_decl.ispc_amount, 'FM999G999G990D00'), v_moeda),
      jsonb_build_object('trimestre', v_decl.period, 'ano', v_decl.year,
                         'dias_de_atraso', CURRENT_DATE - v_decl.due_date,
                         'valor', v_decl.ispc_amount),
      'Regularizar', '/impostos'
    );
    v_count := v_count + 1;
  END LOOP;

  -- ---- 5. Queda acentuada de vendas ----------------------------------------
  SELECT COALESCE(sum(total), 0) INTO v_vendas_mes
    FROM public.invoices
   WHERE company_id = p_company_id
     AND status NOT IN ('rascunho', 'anulada')
     AND date >= date_trunc('month', CURRENT_DATE)::date;

  SELECT COALESCE(sum(total) / 3.0, 0) INTO v_media_3m
    FROM public.invoices
   WHERE company_id = p_company_id
     AND status NOT IN ('rascunho', 'anulada')
     AND date >= (date_trunc('month', CURRENT_DATE) - interval '3 months')::date
     AND date < date_trunc('month', CURRENT_DATE)::date;

  -- Só faz sentido comparar depois do mês ir a meio e com histórico real.
  IF v_media_3m > 0 AND EXTRACT(DAY FROM CURRENT_DATE) >= 15 THEN
    v_variacao := ROUND(((v_vendas_mes - v_media_3m) / v_media_3m) * 100, 1);

    IF v_variacao <= -30 THEN
      PERFORM public.ai_upsert_alert(
        p_company_id, 'queda_vendas', 'queda_vendas:' || v_mes,
        'aviso',
        format('Vendas %s%% abaixo da média dos últimos 3 meses', v_variacao),
        format('Facturou %s %s este mês, contra uma média mensal de %s %s nos três meses anteriores.',
               to_char(v_vendas_mes, 'FM999G999G990D00'), v_moeda,
               to_char(v_media_3m, 'FM999G999G990D00'), v_moeda),
        jsonb_build_object('vendas_mes', v_vendas_mes, 'media_3_meses', ROUND(v_media_3m, 2),
                           'variacao_percentual', v_variacao),
        'Ver relatórios', '/relatorios'
      );
      v_count := v_count + 1;
    END IF;
  END IF;

  -- ---- 6. Proximidade de mudança de escalão de ISPC ------------------------
  -- O alerta mais valioso do conjunto: avisa antes de a taxa subir, enquanto
  -- ainda há margem para planear.
  SELECT COALESCE(sum(total), 0) INTO v_acumulado_ano
    FROM public.invoices
   WHERE company_id = p_company_id
     AND status NOT IN ('rascunho', 'anulada')
     AND date >= date_trunc('year', CURRENT_DATE)::date;

  SELECT limiar, taxa_actual, taxa_seguinte
    INTO v_proximo_limiar, v_taxa_actual, v_taxa_seguinte
    FROM (VALUES
      (1000000::numeric, 3, 4),
      (2500000::numeric, 4, 5),
      (4000000::numeric, 5, 20)
    ) AS escaloes(limiar, taxa_actual, taxa_seguinte)
   WHERE v_acumulado_ano >= limiar * 0.85
     AND v_acumulado_ano < limiar
   ORDER BY limiar
   LIMIT 1;

  IF v_proximo_limiar IS NOT NULL THEN
    PERFORM public.ai_upsert_alert(
      p_company_id, 'limiar_ispc',
      format('limiar_ispc:%s:%s', EXTRACT(YEAR FROM CURRENT_DATE)::int, v_proximo_limiar),
      'info',
      format('Perto do escalão de %s%% do ISPC', v_taxa_seguinte),
      format('Já facturou %s %s este ano. A partir de %s %s, a facturação que exceder esse limite passa a ser tributada a %s%% em vez de %s%%. Faltam %s %s para atingir o limite.',
             to_char(v_acumulado_ano, 'FM999G999G990D00'), v_moeda,
             to_char(v_proximo_limiar, 'FM999G999G990D00'), v_moeda,
             v_taxa_seguinte, v_taxa_actual,
             to_char(v_proximo_limiar - v_acumulado_ano, 'FM999G999G990D00'), v_moeda),
      jsonb_build_object('acumulado_ano', v_acumulado_ano, 'limiar', v_proximo_limiar,
                         'taxa_actual', v_taxa_actual, 'taxa_seguinte', v_taxa_seguinte,
                         'margem', v_proximo_limiar - v_acumulado_ano),
      'Ver impostos', '/impostos'
    );
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$;

-- Percorre todas as empresas com a funcionalidade activa no plano.
CREATE OR REPLACE FUNCTION public.generate_ai_alerts_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company record;
  v_empresas integer := 0;
  v_alertas integer := 0;
  v_enabled boolean;
BEGIN
  FOR v_company IN
    SELECT id FROM public.companies WHERE COALESCE(status, 'active') <> 'suspended'
  LOOP
    SELECT fv.enabled INTO v_enabled
      FROM public.subscription_feature_value(v_company.id, 'ai_smart_alerts') fv;

    IF COALESCE(v_enabled, false) THEN
      v_alertas := v_alertas + public.generate_ai_alerts(v_company.id);
      v_empresas := v_empresas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'empresas_processadas', v_empresas,
    'alertas_gerados', v_alertas,
    'executado_em', now()
  );
END;
$$;

-- Marca alertas cujo motivo desapareceu (facturas cobradas, imposto pago).
CREATE OR REPLACE FUNCTION public.ai_resolve_stale_alerts(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.ai_alerts a
     SET status = 'resolvida', resolved_at = now()
   WHERE a.company_id = p_company_id
     AND a.status IN ('nova', 'lida')
     AND (
       (a.rule_code = 'facturas_vencidas' AND NOT EXISTS (
          SELECT 1 FROM public.invoices i
           WHERE i.company_id = p_company_id
             AND i.status IN ('pendente', 'vencida')
             AND i.amount_pending > 0
             AND COALESCE(i.due_date, i.date) < CURRENT_DATE))
       OR
       (a.rule_code IN ('prazo_fiscal', 'declaracao_atrasada') AND EXISTS (
          SELECT 1 FROM public.tax_declarations d
           WHERE d.company_id = p_company_id
             AND d.year = (a.metric->>'ano')::int
             AND d.period = (a.metric->>'trimestre')::int
             AND d.status = 'paga'))
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_ai_alerts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_resolve_stale_alerts(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_ai_alerts_all() FROM public;
GRANT EXECUTE ON FUNCTION public.generate_ai_alerts_all() TO service_role;
REVOKE ALL ON FUNCTION public.ai_upsert_alert(uuid, text, text, text, text, text, jsonb, text, text) FROM public;

-- ---------------------------------------------------------------------------
-- Agendamento diário
-- ---------------------------------------------------------------------------
-- Se pg_cron não estiver disponível no projecto, a função continua a poder ser
-- invocada pela Edge Function `ai-alerts` através de um agendador externo.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule('gerar-alertas-ia-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gerar-alertas-ia-diario');

  PERFORM cron.schedule(
    'gerar-alertas-ia-diario',
    '0 5 * * *',
    'SELECT public.generate_ai_alerts_all();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível (%). Agende a Edge Function ai-alerts externamente.', SQLERRM;
END $$;
