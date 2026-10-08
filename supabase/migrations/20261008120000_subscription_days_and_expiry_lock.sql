-- 1) Períodos de subscrição contados em dias (30 dias por mês de pacote).
-- 2) plan_id passa a acompanhar o plan_name quando o plano muda (antes ficava
--    preso ao plano Trial e os limites do servidor nunca mudavam).
-- 3) Subscrição/período experimental expirado bloqueia a criação de dados.

-- ---------------------------------------------------------------------------
-- 1. Duração do ciclo em dias
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_cycle_days(p_cycle text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_cycle
    WHEN 'quarterly'  THEN 90
    WHEN 'semiannual' THEN 180
    WHEN 'yearly'     THEN 360
    ELSE 30
  END;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_cycle_days(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. plan_id sincronizado com plan_name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_subscription_plan_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan_name IS NOT NULL AND (
       NEW.plan_id IS NULL
       OR (TG_OP = 'UPDATE'
           AND NEW.plan_name IS DISTINCT FROM OLD.plan_name
           AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id)
     ) THEN
    NEW.plan_id := COALESCE((
      SELECT id FROM public.subscription_plans
       WHERE lower(trim(code)) = lower(trim(NEW.plan_name))
          OR lower(trim(name)) = lower(trim(NEW.plan_name))
       LIMIT 1
    ), NEW.plan_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Corrigir subscrições existentes cujo plan_id não corresponde ao plan_name
UPDATE public.subscriptions s
   SET plan_id = p.id
  FROM public.subscription_plans p
 WHERE (lower(trim(s.plan_name)) = lower(trim(p.name)) OR lower(trim(s.plan_name)) = lower(trim(p.code)))
   AND s.plan_id IS DISTINCT FROM p.id;

-- ---------------------------------------------------------------------------
-- 3. Bloqueio após expiração
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_subscription_active(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.company_id = p_company_id
       AND s.status IN ('active', 'trialing')
       AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
  );
$$;

GRANT EXECUTE ON FUNCTION public.company_subscription_active(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_active_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Operações de sistema (service role / webhooks) passam.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_subscription_active(NEW.company_id) THEN
    RAISE EXCEPTION 'A subscrição desta empresa expirou. Renove o plano em Configurações → Subscrição para continuar a usar o sistema.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_active_subscription_invoices ON public.invoices;
CREATE TRIGGER enforce_active_subscription_invoices
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS enforce_active_subscription_payments ON public.payments;
CREATE TRIGGER enforce_active_subscription_payments
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS enforce_active_subscription_clients ON public.clients;
CREATE TRIGGER enforce_active_subscription_clients
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

DROP TRIGGER IF EXISTS enforce_active_subscription_products ON public.products;
CREATE TRIGGER enforce_active_subscription_products
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

-- company_users não é bloqueado aqui: create_company_owner() insere o owner
-- antes de criar a subscrição Trial da nova empresa.
