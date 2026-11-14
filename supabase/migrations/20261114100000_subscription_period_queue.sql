-- Fila de períodos de subscrição.
--
-- Cada pagamento confirmado (ou activação com voucher, ou confirmação manual
-- do admin) passa a criar um PERÍODO com o seu próprio plano. Se a empresa
-- ainda tem tempo pago, o novo período começa no dia seguinte ao fim do último
-- (fila); se não tem, começa hoje. Deixa de existir o bloqueio de downgrade:
-- um plano inferior ou um ciclo mais curto simplesmente entra na fila.
--
-- Regras:
--   * Duração em dias (1 mês = 30). end_date é inclusivo: start + dias - 1.
--   * O plano em vigor é o do período que cobre hoje (fuso de Maputo).
--   * Pago -> gratuito (Trial) continua bloqueado.
--   * O período experimental (Trial) não segura a fila: um pagamento feito
--     durante o Trial começa hoje.
--   * Limite: um período novo não pode começar mais de 360 dias depois de hoje
--     (verificado antes da cobrança; um pagamento já cobrado entra sempre).
--   * Só o admin cancela períodos. Os seguintes não se movem sozinhos.
--
-- A linha de public.subscriptions continua a existir como RESUMO (plano em
-- vigor, início do período em vigor, fim do último período), porque muitas
-- partes do sistema a lêem. É sincronizada por sync_subscription_from_periods():
-- ao criar/cancelar um período, todos os dias às 00:05 de Maputo (pg_cron) e
-- sempre que a interface carrega a subscrição (refresh_company_subscription).
-- As verificações do servidor (subscription_plan_for_company, company_pos_access)
-- lêem directamente o período em vigor, por isso não dependem dessa sincronização.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id         uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  plan_name       text NOT NULL,
  billing_cycle   text NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  amount          numeric(10,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'MZN',
  payment_method  text,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  payment_id      uuid UNIQUE REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  source          text NOT NULL DEFAULT 'payment'
                  CHECK (source IN ('payment', 'manual', 'voucher', 'legacy')),
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_periods_dates CHECK (end_date >= start_date)
);

COMMENT ON TABLE public.subscription_periods IS
  'Fila de períodos de subscrição: um por pagamento. O plano em vigor é o do período que cobre hoje.';
COMMENT ON COLUMN public.subscription_periods.end_date IS 'Inclusivo: start_date + dias do ciclo - 1.';
COMMENT ON COLUMN public.subscription_periods.source IS
  'payment = Sislog; manual = confirmado pelo admin; voucher = activação a 0 MZN; legacy = criado a partir da subscrição existente.';

CREATE INDEX IF NOT EXISTS idx_subscription_periods_company_dates
  ON public.subscription_periods (company_id, start_date, end_date)
  WHERE cancelled_at IS NULL;

ALTER TABLE public.subscription_periods ENABLE ROW LEVEL SECURITY;

-- Leitura para membros da empresa e administradores. Escritas só pelas funções
-- SECURITY DEFINER abaixo (e pelo service role).
DROP POLICY IF EXISTS "Members can view subscription periods" ON public.subscription_periods;
CREATE POLICY "Members can view subscription periods"
  ON public.subscription_periods FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR public.is_company_member(company_id)
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.user_id = auth.uid())
  );

GRANT SELECT ON public.subscription_periods TO authenticated;
GRANT ALL ON public.subscription_periods TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers internos
-- ---------------------------------------------------------------------------
-- Período em vigor hoje (linha toda a NULL se não houver).
CREATE OR REPLACE FUNCTION public.subscription_current_period(p_company_id uuid)
RETURNS public.subscription_periods
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
    FROM public.subscription_periods p
   WHERE p.company_id = p_company_id
     AND p.cancelled_at IS NULL
     AND p.start_date <= public.subscription_today()
     AND p.end_date   >= public.subscription_today()
   ORDER BY p.start_date DESC, p.created_at DESC
   LIMIT 1;
$$;

-- Plano (id e preço mensal) pelo nome ou código.
CREATE OR REPLACE FUNCTION public.subscription_find_plan(p_plan_name text)
RETURNS TABLE (id uuid, name text, monthly_price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.monthly_price
    FROM public.subscription_plans p
   WHERE lower(trim(p.name)) = lower(trim(p_plan_name))
      OR lower(trim(p.code)) = lower(trim(p_plan_name))
   ORDER BY p.is_active DESC
   LIMIT 1;
$$;

-- Empresa sem períodos mas com uma subscrição paga ainda activa (anterior a
-- esta migração): cria um período 'legacy' com as datas actuais, para que os
-- pagamentos seguintes entrem na fila depois dele.
CREATE OR REPLACE FUNCTION public.subscription_ensure_legacy_period(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s       record;
  v_today date := public.subscription_today();
  v_end   date;
  v_price numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscription_periods WHERE company_id = p_company_id) THEN
    RETURN;
  END IF;

  SELECT * INTO s
    FROM public.subscriptions
   WHERE company_id = p_company_id
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND OR s.end_date IS NULL OR s.status NOT IN ('active', 'trialing') THEN
    RETURN;
  END IF;

  v_end := s.end_date::date;
  IF v_end < v_today THEN
    RETURN;
  END IF;

  -- O Trial (plano gratuito) não entra na fila.
  v_price := public.subscription_plan_monthly_price(s.plan_id, s.plan_name);
  IF COALESCE(v_price, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.subscription_periods (
    company_id, plan_id, plan_name, billing_cycle, amount, currency, payment_method,
    start_date, end_date, source, created_by
  ) VALUES (
    p_company_id, s.plan_id, s.plan_name,
    CASE WHEN s.billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'yearly') THEN s.billing_cycle ELSE 'monthly' END,
    COALESCE(s.amount, 0), COALESCE(s.currency, 'MZN'), s.payment_method,
    LEAST(COALESCE(s.start_date::date, v_today), v_end), v_end, 'legacy', NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sincronizar o resumo em public.subscriptions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_subscription_from_periods(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today    date := public.subscription_today();
  v_cur      public.subscription_periods;
  v_last_end date;
  v_past_end date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.subscription_periods WHERE company_id = p_company_id) THEN
    RETURN;  -- Empresa só com o Trial (ou sem nada): a linha é a fonte.
  END IF;

  -- Deixa o trigger de protecção saber que esta escrita vem do sistema.
  PERFORM set_config('app.subscription_sync', 'on', true);

  SELECT * INTO v_cur FROM public.subscription_current_period(p_company_id);

  IF v_cur.id IS NULL THEN
    -- Nenhum período cobre hoje (expirou, ou o admin cancelou o actual).
    SELECT max(end_date) INTO v_past_end
      FROM public.subscription_periods
     WHERE company_id = p_company_id AND cancelled_at IS NULL AND end_date < v_today;
    UPDATE public.subscriptions
       SET end_date = COALESCE(v_past_end, v_today - 1),
           next_billing_date = COALESCE(v_past_end, v_today - 1),
           updated_at = now()
     WHERE company_id = p_company_id
       AND (end_date IS NULL OR end_date::date >= v_today);
    PERFORM set_config('app.subscription_sync', 'off', true);
    RETURN;
  END IF;

  SELECT max(end_date) INTO v_last_end
    FROM public.subscription_periods
   WHERE company_id = p_company_id AND cancelled_at IS NULL;

  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE company_id = p_company_id) THEN
    UPDATE public.subscriptions
       SET plan_name         = v_cur.plan_name,
           plan_id           = COALESCE(v_cur.plan_id, plan_id),
           billing_cycle     = v_cur.billing_cycle,
           amount            = v_cur.amount,
           currency          = v_cur.currency,
           payment_method    = COALESCE(v_cur.payment_method, payment_method),
           status            = 'active',
           start_date        = v_cur.start_date,
           end_date          = v_last_end,
           next_billing_date = v_last_end,
           updated_at        = now()
     WHERE company_id = p_company_id
       AND (   plan_name         IS DISTINCT FROM v_cur.plan_name
            OR (v_cur.plan_id IS NOT NULL AND plan_id IS DISTINCT FROM v_cur.plan_id)
            OR billing_cycle     IS DISTINCT FROM v_cur.billing_cycle
            OR amount            IS DISTINCT FROM v_cur.amount
            OR status            IS DISTINCT FROM 'active'
            OR start_date::date  IS DISTINCT FROM v_cur.start_date
            OR end_date::date    IS DISTINCT FROM v_last_end
            OR next_billing_date::date IS DISTINCT FROM v_last_end);
  ELSE
    INSERT INTO public.subscriptions (
      company_id, plan_id, plan_name, billing_cycle, amount, currency, payment_method,
      status, start_date, end_date, next_billing_date, updated_at
    ) VALUES (
      p_company_id, v_cur.plan_id, v_cur.plan_name, v_cur.billing_cycle, v_cur.amount, v_cur.currency,
      v_cur.payment_method, 'active', v_cur.start_date, v_last_end, v_last_end, now()
    );
  END IF;

  PERFORM set_config('app.subscription_sync', 'off', true);
END;
$$;

-- Todas as empresas cujo período muda hoje (corre às 00:05 de Maputo).
CREATE OR REPLACE FUNCTION public.sync_all_subscription_periods()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.subscription_today();
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT company_id
      FROM public.subscription_periods
     WHERE start_date = v_today          -- começa um período
        OR end_date   = v_today - 1      -- acabou um período ontem
        OR cancelled_at >= now() - interval '2 days'
  LOOP
    PERFORM public.sync_subscription_from_periods(r.company_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Chamada pela interface ao carregar a subscrição.
CREATE OR REPLACE FUNCTION public.refresh_company_subscription(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_admin()
     AND NOT public.is_company_member(p_company_id)
     AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sync_subscription_from_periods(p_company_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pode comprar? (antes da cobrança)
-- ---------------------------------------------------------------------------
-- Devolve NULL se a compra é permitida, ou o código do bloqueio:
--   SUBSCRIPTION_DOWNGRADE_BLOCKED  plano gratuito (voltar ao Trial)
--   SUBSCRIPTION_QUEUE_LIMIT        a fila já tem mais de 360 dias à frente
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
-- 5. Criar um período (entra na fila)
-- ---------------------------------------------------------------------------
-- Quem pode chamar:
--   * service role (sislog-webhook) e administradores: qualquer plano pago,
--     sem limite de fila (o dinheiro já foi cobrado);
--   * membros da empresa: só activação com voucher a 0 MZN (como antes, quando
--     o browser escrevia directamente em subscriptions), com o limite de fila.
-- Idempotente por p_payment_id: o mesmo pagamento nunca cria dois períodos.
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
  v_row        public.subscription_periods;
  v_reason     text;
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

  SELECT max(end_date) INTO v_last_end
    FROM public.subscription_periods
   WHERE company_id = p_company_id AND cancelled_at IS NULL;

  v_start := GREATEST(v_today, COALESCE(v_last_end + 1, v_today));

  INSERT INTO public.subscription_periods (
    company_id, plan_id, plan_name, billing_cycle, amount, currency, payment_method,
    start_date, end_date, payment_id, source
  ) VALUES (
    p_company_id, v_plan.id, COALESCE(v_plan.name, p_plan_name), p_billing_cycle,
    COALESCE(p_amount, 0), COALESCE(p_currency, 'MZN'), p_payment_method,
    v_start, v_start + v_days - 1, p_payment_id, p_source
  )
  RETURNING * INTO v_row;

  PERFORM public.sync_subscription_from_periods(p_company_id);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cancelar um período (só admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_subscription_period(p_period_id uuid, p_reason text DEFAULT NULL)
RETURNS public.subscription_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.subscription_periods;
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Só o administrador pode cancelar períodos de subscrição.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.subscription_periods
     SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
   WHERE id = p_period_id AND cancelled_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Período não encontrado ou já cancelado.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.sync_subscription_from_periods(v_row.company_id);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Leitores do plano passam a usar o período em vigor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_plan_for_company(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.plan_id, (SELECT f.id FROM public.subscription_find_plan(p.plan_name) f))
       FROM public.subscription_periods p
      WHERE p.company_id = p_company_id
        AND p.cancelled_at IS NULL
        AND p.start_date <= public.subscription_today()
        AND p.end_date   >= public.subscription_today()
      ORDER BY p.start_date DESC, p.created_at DESC
      LIMIT 1),
    (SELECT s.plan_id FROM public.subscriptions s
      WHERE s.company_id = p_company_id
        AND s.status IN ('active', 'trialing')
        AND (s.end_date IS NULL OR s.end_date::date >= public.subscription_today())
      ORDER BY s.updated_at DESC LIMIT 1),
    (SELECT p.id FROM public.subscription_plans p WHERE p.code = 'trial' LIMIT 1)
  );
$$;

-- Igual a 20261105100000_fix_pos_access_end_date, mas o plano vem do período em vigor.
CREATE OR REPLACE FUNCTION public.company_pos_access(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
  v_grace integer;
  v_enabled boolean;
  v_active boolean;
  v_in_grace boolean := false;
  v_grace_until date;
  v_end date;
  v_plan_id uuid;
BEGIN
  SELECT s.plan_id, s.status, s.end_date
    INTO v_sub
    FROM subscriptions s
   WHERE s.company_id = p_company_id
   ORDER BY (s.status IN ('active', 'trialing')) DESC, s.end_date DESC NULLS FIRST, s.updated_at DESC
   LIMIT 1;

  v_plan_id := COALESCE(
    (SELECT COALESCE(p.plan_id, (SELECT f.id FROM public.subscription_find_plan(p.plan_name) f))
       FROM public.subscription_current_period(p_company_id) p
      WHERE p.id IS NOT NULL),
    v_sub.plan_id
  );

  SELECT COALESCE(o.enabled, pf.enabled, false)
    INTO v_enabled
    FROM subscription_features f
    LEFT JOIN subscription_plan_features pf ON pf.feature_id = f.id AND pf.plan_id = v_plan_id
    LEFT JOIN company_feature_overrides o ON o.company_id = p_company_id AND o.feature_code = f.code
   WHERE f.code = 'pos' AND f.is_active;
  v_enabled := COALESCE(v_enabled, false);

  v_grace := COALESCE(
    (SELECT (value #>> '{}')::integer FROM platform_settings WHERE key = 'pos_grace_days'),
    5
  );

  v_end := (v_sub.end_date AT TIME ZONE 'Africa/Maputo')::date;

  v_active := v_sub.status IN ('active', 'trialing')
              AND (v_end IS NULL OR v_end >= v_today);

  IF NOT COALESCE(v_active, false) AND v_end IS NOT NULL
     AND v_sub.status IN ('active', 'trialing', 'past_due') THEN
    v_grace_until := v_end + v_grace;
    v_in_grace := v_today <= v_grace_until;
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'active', COALESCE(v_active, false),
    'in_grace', v_in_grace,
    'grace_until', v_grace_until,
    'end_date', v_end,
    'allowed', v_enabled AND (COALESCE(v_active, false) OR v_in_grace)
  );
END;
$$;

-- O nível do plano mostrado na interface também vem do período em vigor.
CREATE OR REPLACE FUNCTION public.get_company_plan_level(p_company_id uuid)
RETURNS TABLE (plan_name text, tier integer, monthly_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id   uuid;
  v_plan_name text;
  v_cur       public.subscription_periods;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_admin() OR public.is_company_member(p_company_id)) THEN
    RETURN;
  END IF;

  SELECT * INTO v_cur FROM public.subscription_current_period(p_company_id);
  IF v_cur.id IS NOT NULL THEN
    v_plan_id := v_cur.plan_id;
    v_plan_name := v_cur.plan_name;
  ELSE
    SELECT sub.plan_id, sub.plan_name
      INTO v_plan_id, v_plan_name
      FROM public.subscriptions sub
     WHERE sub.company_id = p_company_id
     ORDER BY sub.updated_at DESC NULLS LAST
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN;
    END IF;
  END IF;

  plan_name     := v_plan_name;
  tier          := public.subscription_plan_tier(v_plan_id, v_plan_name);
  monthly_price := public.subscription_plan_monthly_price(v_plan_id, v_plan_name);
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Fim do bloqueio de downgrade
-- ---------------------------------------------------------------------------
-- Mantida para as edge functions antigas ainda em produção durante o deploy:
-- passa a bloquear só o regresso ao plano gratuito e o limite da fila.
CREATE OR REPLACE FUNCTION public.is_subscription_downgrade(
  p_company_id   uuid,
  p_target_plan  text,
  p_target_cycle text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.subscription_purchase_block_reason(p_company_id, p_target_plan, COALESCE(p_target_cycle, 'monthly')) IS NOT NULL;
END;
$$;

-- Trigger em subscriptions: o browser deixa de poder mudar plano, ciclo, valor
-- ou datas (antes podia prolongar end_date à vontade). Estas colunas só mudam
-- pelas funções acima (flag app.subscription_sync), pelo service role ou pelo admin.
CREATE OR REPLACE FUNCTION public.prevent_subscription_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_active boolean;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_admin()
     OR current_setting('app.subscription_sync', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Não é possível eliminar a subscrição.'
      USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_DELETE_BLOCKED';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.company_id) THEN
      IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
      END IF;
      RAISE EXCEPTION 'A empresa já tem uma subscrição; actualize a subscrição existente.'
        USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_INSERT_BLOCKED';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Não é possível mudar a empresa da subscrição.'
      USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_COMPANY_CHANGE_BLOCKED';
  END IF;

  IF NEW.plan_name         IS DISTINCT FROM OLD.plan_name
     OR NEW.plan_id        IS DISTINCT FROM OLD.plan_id
     OR NEW.billing_cycle  IS DISTINCT FROM OLD.billing_cycle
     OR NEW.amount         IS DISTINCT FROM OLD.amount
     OR NEW.start_date     IS DISTINCT FROM OLD.start_date
     OR NEW.end_date       IS DISTINCT FROM OLD.end_date
     OR NEW.next_billing_date IS DISTINCT FROM OLD.next_billing_date THEN
    RAISE EXCEPTION 'O plano e as datas da subscrição só mudam através de um pagamento.'
      USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_CHANGE_BLOCKED';
  END IF;

  v_old_active := OLD.status IN ('active', 'trialing')
                  AND (OLD.end_date IS NULL OR OLD.end_date::date >= public.subscription_today());
  IF v_old_active AND (NEW.status IS NULL OR NEW.status NOT IN ('active', 'trialing')) THEN
    RAISE EXCEPTION 'Não é possível desactivar a subscrição enquanto o período actual estiver activo.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Permissões
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.subscription_current_period(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_find_plan(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_ensure_legacy_period(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_subscription_from_periods(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_all_subscription_periods() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_company_subscription(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.subscription_purchase_block_reason(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_subscription_period(uuid, text, text, numeric, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_subscription_period(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_subscription_downgrade(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.subscription_current_period(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_find_plan(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_ensure_legacy_period(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_subscription_from_periods(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_all_subscription_periods() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_subscription(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscription_purchase_block_reason(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_subscription_period(uuid, text, text, numeric, text, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_period(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_subscription_downgrade(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Subscrições pagas activas passam a ter o seu período
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT company_id FROM public.subscriptions LOOP
    PERFORM public.subscription_ensure_legacy_period(r.company_id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Sincronização diária (22:05 UTC = 00:05 em Maputo)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule('subscricoes-periodos-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscricoes-periodos-diario');

  PERFORM cron.schedule(
    'subscricoes-periodos-diario',
    '5 22 * * *',
    'SELECT public.sync_all_subscription_periods();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível (%). A linha subscriptions é sincronizada quando a interface a carrega.', SQLERRM;
END $$;
