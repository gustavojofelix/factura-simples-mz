-- Back office: o plano atribuído pode começar HOJE.
--
-- Até aqui, um plano atribuído no back office a uma empresa que ainda tinha
-- tempo pago só começava hoje se fosse de nível superior; nos outros casos ia
-- para o fim da fila. O cliente recebia o e-mail "plano activo", mas no front
-- office continuava a ver o plano anterior, só com a data de expiração mais longe.
--
-- enqueue_subscription_period ganha p_start_now (só para o admin / service role):
-- com true, o período novo começa hoje seja qual for o nível do plano, pelas
-- mesmas regras do upgrade (20261127100000): o período em vigor fecha ontem, os
-- dias pagos que restavam são convertidos em dias extra do plano novo pelo valor
-- proporcional (nunca mais dias do que os que restavam) e os períodos em fila
-- passam para depois do novo. Sem período em vigor (Trial ou expirado) já
-- começava hoje, e continua.
--
-- Com false (omissão) nada muda: pagamentos Sislog, vouchers e confirmações
-- manuais continuam como antes.

-- A assinatura muda (mais um parâmetro): a versão antiga tem de sair, senão as
-- chamadas sem p_start_now ficam ambíguas entre as duas.
DROP FUNCTION IF EXISTS public.enqueue_subscription_period(uuid, text, text, numeric, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.enqueue_subscription_period(
  p_company_id     uuid,
  p_plan_name      text,
  p_billing_cycle  text,
  p_amount         numeric,
  p_currency       text DEFAULT 'MZN',
  p_payment_method text DEFAULT NULL,
  p_payment_id     uuid DEFAULT NULL,
  p_source         text DEFAULT 'payment',
  p_start_now      boolean DEFAULT false
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

  -- Back office, "começa hoje": trata-se como um upgrade, seja qual for o nível
  -- do plano, desde que haja um período em vigor para substituir.
  IF NOT v_upgrade AND COALESCE(p_start_now, false) AND v_privileged AND v_plan.id IS NOT NULL THEN
    SELECT * INTO v_cur FROM public.subscription_current_period(p_company_id);
    v_upgrade := v_cur.id IS NOT NULL;
  END IF;

  IF v_upgrade THEN
    -- Plano superior (ou atribuição imediata pelo back office): começa hoje.
    -- Os dias que restavam viram dias extra.
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
         SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Substituído por um plano que começa hoje'
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

REVOKE ALL ON FUNCTION public.enqueue_subscription_period(uuid, text, text, numeric, text, text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_subscription_period(uuid, text, text, numeric, text, text, uuid, text, boolean) TO authenticated, service_role;
