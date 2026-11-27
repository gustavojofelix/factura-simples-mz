-- Upgrade imediato com crédito.
--
-- Até aqui, qualquer compra feita com tempo pago ia para o fim da fila, mesmo
-- quando o cliente comprava um plano superior. Passa a haver um caso novo:
--
--   * O plano comprado é de NÍVEL SUPERIOR (subscription_plans.tier) ao plano
--     do período em vigor: o novo período começa HOJE. O período em vigor fecha
--     ontem e os dias pagos que restavam são convertidos em dias extra do plano
--     novo, pelo valor proporcional.
--   * Tudo o resto (renovação, plano igual ou inferior) continua a ir para a fila.
--
-- Crédito:
--   valor   = (valor pago + crédito herdado) do período em vigor
--             x dias que restam (hoje incluído) / duração do período
--   dias    = floor(valor / preço diário de tabela do plano novo no ciclo comprado)
--   limite  = nunca mais dias extra do que os dias que restavam.
-- O cliente paga o preço normal do plano novo: não há desconto nem reembolso.
-- Períodos a 0 MZN (oferta, voucher) não geram crédito.
--
-- Períodos que já estavam em fila não são alterados: passam para depois do
-- período novo, pela mesma ordem.

-- ---------------------------------------------------------------------------
-- 1. Colunas de registo do upgrade
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_periods
  ADD COLUMN IF NOT EXISTS credit_days        integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_amount      numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replaces_period_id uuid REFERENCES public.subscription_periods(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.subscription_periods.credit_days IS
  'Dias extra incluídos em end_date, vindos do período substituído num upgrade.';
COMMENT ON COLUMN public.subscription_periods.credit_amount IS
  'Valor (MZN) dos dias não usados do período substituído num upgrade.';
COMMENT ON COLUMN public.subscription_periods.replaces_period_id IS
  'Período que este upgrade substituiu (fechado no dia anterior ao início deste).';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Preço de tabela de um plano para um ciclo. Igual a planCyclePrice() na interface.
CREATE OR REPLACE FUNCTION public.subscription_plan_cycle_price(p_plan_id uuid, p_cycle text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_cycle
           WHEN 'quarterly'  THEN COALESCE(NULLIF(p.three_months_price, 0), p.monthly_price * 3)
           WHEN 'semiannual' THEN COALESCE(NULLIF(p.six_months_price, 0), p.monthly_price * 6)
           WHEN 'yearly'     THEN p.yearly_price
           ELSE p.monthly_price
         END
    FROM public.subscription_plans p
   WHERE p.id = p_plan_id;
$$;

-- A compra de p_plan_name é um upgrade? (há período em vigor e o plano novo é de nível superior)
CREATE OR REPLACE FUNCTION public.subscription_purchase_is_upgrade(p_company_id uuid, p_plan_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur      public.subscription_periods;
  v_cur_tier integer;
  v_new_tier integer;
BEGIN
  SELECT * INTO v_cur FROM public.subscription_current_period(p_company_id);
  IF v_cur.id IS NULL THEN
    RETURN false;
  END IF;
  v_cur_tier := public.subscription_plan_tier(v_cur.plan_id, v_cur.plan_name);
  v_new_tier := public.subscription_plan_tier(NULL, p_plan_name);
  RETURN v_cur_tier IS NOT NULL AND v_new_tier IS NOT NULL AND v_new_tier > v_cur_tier;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_plan_cycle_price(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_purchase_is_upgrade(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_plan_cycle_price(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_purchase_is_upgrade(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Pode comprar? Um upgrade começa hoje, por isso o limite da fila não se aplica.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_purchase_block_reason(
  p_company_id    uuid,
  p_plan_name     text,
  p_billing_cycle text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan     record;
  v_today    date := public.subscription_today();
  v_last_end date;
  v_start    date;
  s          record;
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_admin()
     AND NOT public.is_company_member(p_company_id)
     AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_find_plan(p_plan_name);
  IF FOUND AND COALESCE(v_plan.monthly_price, 0) = 0 THEN
    RETURN 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
  END IF;

  IF public.subscription_purchase_is_upgrade(p_company_id, p_plan_name) THEN
    RETURN NULL;
  END IF;

  SELECT max(end_date) INTO v_last_end
    FROM public.subscription_periods
   WHERE company_id = p_company_id AND cancelled_at IS NULL;

  -- Ainda sem períodos: uma subscrição paga activa (anterior à fila) conta.
  IF v_last_end IS NULL THEN
    SELECT plan_id, plan_name, status, end_date INTO s
      FROM public.subscriptions
     WHERE company_id = p_company_id
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1;
    IF FOUND AND s.status IN ('active', 'trialing') AND s.end_date IS NOT NULL
       AND COALESCE(public.subscription_plan_monthly_price(s.plan_id, s.plan_name), 0) > 0 THEN
      v_last_end := s.end_date::date;
    END IF;
  END IF;

  v_start := GREATEST(v_today, COALESCE(v_last_end + 1, v_today));
  IF v_start - v_today > 360 THEN
    RETURN 'SUBSCRIPTION_QUEUE_LIMIT';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Criar um período: upgrade começa hoje, o resto entra na fila
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_subscription_period(
  p_company_id     uuid,
  p_plan_name      text,
  p_billing_cycle  text,
  p_amount         numeric,
  p_currency       text DEFAULT 'MZN',
  p_payment_method text DEFAULT NULL,
  p_payment_id     uuid DEFAULT NULL,
  p_source         text DEFAULT 'payment'
)
RETURNS public.subscription_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_privileged boolean;
  v_system     boolean;
  v_plan       record;
  v_days       integer;
  v_today      date := public.subscription_today();
  v_last_end   date;
  v_start      date;
  v_end        date;
  v_row        public.subscription_periods;
  v_reason     text;
  -- upgrade
  v_cur        public.subscription_periods;
  v_upgrade    boolean := false;
  v_rem        integer;
  v_len        integer;
  v_list       numeric;
  v_credit     numeric := 0;
  v_extra      integer := 0;
  v_replaces   uuid;
  v_next       date;
  v_shift      integer;
BEGIN
  v_system     := auth.uid() IS NULL OR COALESCE(auth.role(), '') = 'service_role';
  v_privileged := v_system OR public.is_admin();

  IF NOT v_privileged THEN
    IF NOT (public.is_company_member(p_company_id)
            OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid())) THEN
      RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
    END IF;
    IF p_source IS DISTINCT FROM 'voucher' OR COALESCE(p_amount, 0) <> 0 OR p_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Só é possível activar um plano através de um pagamento.'
        USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_CHANGE_BLOCKED';
    END IF;
  END IF;

  IF p_billing_cycle NOT IN ('monthly', 'quarterly', 'semiannual', 'yearly') THEN
    RAISE EXCEPTION 'Ciclo de facturação inválido: %', p_billing_cycle USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('payment', 'manual', 'voucher') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_source USING ERRCODE = '22023';
  END IF;
  v_days := public.subscription_cycle_days(p_billing_cycle);

  SELECT * INTO v_plan FROM public.subscription_find_plan(p_plan_name);
  IF NOT FOUND AND NOT v_privileged THEN
    RAISE EXCEPTION 'Plano desconhecido: %', p_plan_name USING ERRCODE = '22023';
  END IF;

  -- Uma operação de cada vez por empresa: dois pagamentos confirmados ao mesmo
  -- tempo ficam um a seguir ao outro, nunca sobrepostos.
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription_queue:' || p_company_id::text, 0));

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.subscription_periods WHERE payment_id = p_payment_id;
    IF FOUND THEN
      PERFORM public.sync_subscription_from_periods(p_company_id);
      RETURN v_row;
    END IF;
  END IF;

  -- Pago -> gratuito: sempre bloqueado.
  IF v_plan.id IS NOT NULL AND COALESCE(v_plan.monthly_price, 0) = 0 THEN
    RAISE EXCEPTION 'Não é possível voltar ao período de teste depois de subscrever um plano pago.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
  END IF;

  IF NOT v_privileged THEN
    v_reason := public.subscription_purchase_block_reason(p_company_id, p_plan_name, p_billing_cycle);
    IF v_reason = 'SUBSCRIPTION_QUEUE_LIMIT' THEN
      RAISE EXCEPTION 'Já tem mais de 360 dias de subscrição pagos à frente.'
        USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_QUEUE_LIMIT';
    END IF;
  END IF;

  PERFORM public.subscription_ensure_legacy_period(p_company_id);

  IF v_plan.id IS NOT NULL THEN
    v_upgrade := public.subscription_purchase_is_upgrade(p_company_id, v_plan.name);
  END IF;

  IF v_upgrade THEN
    -- Plano superior: começa hoje. Os dias que restavam viram dias extra.
    SELECT * INTO v_cur FROM public.subscription_current_period(p_company_id);
    v_replaces := v_cur.id;
    v_rem := v_cur.end_date - v_today + 1;
    v_len := v_cur.end_date - v_cur.start_date + 1;
    v_credit := round((COALESCE(v_cur.amount, 0) + COALESCE(v_cur.credit_amount, 0)) * v_rem / v_len, 2);
    v_list := public.subscription_plan_cycle_price(v_plan.id, p_billing_cycle);
    IF COALESCE(v_list, 0) > 0 THEN
      v_extra := LEAST(floor(v_credit * v_days / v_list)::integer, v_rem);
    END IF;

    -- Fecha o período em vigor em ontem (ou cancela-o, se começou hoje).
    IF v_cur.start_date >= v_today THEN
      UPDATE public.subscription_periods
         SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Substituído por upgrade'
       WHERE id = v_cur.id;
    ELSE
      UPDATE public.subscription_periods SET end_date = v_today - 1 WHERE id = v_cur.id;
    END IF;

    v_start := v_today;
    v_end   := v_today + v_days + v_extra - 1;

    -- Os períodos que estavam em fila passam para depois do período novo.
    SELECT min(start_date) INTO v_next
      FROM public.subscription_periods
     WHERE company_id = p_company_id AND cancelled_at IS NULL AND start_date > v_today;
    IF v_next IS NOT NULL THEN
      v_shift := (v_end + 1) - v_next;
      UPDATE public.subscription_periods
         SET start_date = start_date + v_shift, end_date = end_date + v_shift
       WHERE company_id = p_company_id AND cancelled_at IS NULL AND start_date > v_today;
    END IF;
  ELSE
    -- Renovação, plano igual ou inferior: fim da fila.
    SELECT max(end_date) INTO v_last_end
      FROM public.subscription_periods
     WHERE company_id = p_company_id AND cancelled_at IS NULL;

    v_start := GREATEST(v_today, COALESCE(v_last_end + 1, v_today));
    v_end   := v_start + v_days - 1;
    v_credit := 0;
  END IF;

  INSERT INTO public.subscription_periods (
    company_id, plan_id, plan_name, billing_cycle, amount, currency, payment_method,
    start_date, end_date, payment_id, source, credit_days, credit_amount, replaces_period_id
  ) VALUES (
    p_company_id, v_plan.id, COALESCE(v_plan.name, p_plan_name), p_billing_cycle,
    COALESCE(p_amount, 0), COALESCE(p_currency, 'MZN'), p_payment_method,
    v_start, v_end, p_payment_id, p_source, v_extra, v_credit, v_replaces
  )
  RETURNING * INTO v_row;

  PERFORM public.sync_subscription_from_periods(p_company_id);
  RETURN v_row;
END;
$$;
