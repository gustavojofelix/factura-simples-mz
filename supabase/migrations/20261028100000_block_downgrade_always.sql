-- Downgrade do plano passa a ser sempre bloqueado.
--
-- Antes (20261009120000) só se bloqueava a mudança para um plano de nível
-- inferior enquanto a subscrição estivesse activa. Agora:
--   * Plano de nível inferior: sempre bloqueado, mesmo depois de expirar.
--   * Pago -> gratuito (Trial): sempre bloqueado (sem alteração).
--   * Enquanto a subscrição estiver activa, mudar para um ciclo mais curto
--     (ex.: Anual -> Mensal) também é downgrade, salvo se o plano alvo for de
--     nível superior (upgrade de plano com ciclo mensal continua permitido).
--   * Administradores da plataforma e o service role não são bloqueados.

-- ---------------------------------------------------------------------------
-- 1. Regra de nível: deixa de depender do período activo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_change_is_downgrade(
  p_current_plan_id   uuid,
  p_current_plan_name text,
  p_current_status    text,
  p_current_end_date  date,
  p_target_plan_id    uuid,
  p_target_plan_name  text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur_tier   integer;
  v_new_tier   integer;
  v_cur_price  numeric;
  v_new_price  numeric;
BEGIN
  v_cur_tier  := public.subscription_plan_tier(p_current_plan_id, p_current_plan_name);
  v_new_tier  := public.subscription_plan_tier(p_target_plan_id, p_target_plan_name);
  v_cur_price := public.subscription_plan_monthly_price(p_current_plan_id, p_current_plan_name);
  v_new_price := public.subscription_plan_monthly_price(p_target_plan_id, p_target_plan_name);

  -- Plano pago -> plano gratuito.
  IF COALESCE(v_cur_price, 0) > 0 AND v_new_price IS NOT NULL AND v_new_price = 0 THEN
    RETURN true;
  END IF;

  IF v_cur_tier IS NULL OR v_new_tier IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_new_tier < v_cur_tier;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Regra com ciclo de facturação
-- ---------------------------------------------------------------------------
-- Plano alvo NULL (id e nome) = mesmo plano, só muda o ciclo.
CREATE OR REPLACE FUNCTION public.subscription_change_is_downgrade(
  p_current_plan_id   uuid,
  p_current_plan_name text,
  p_current_status    text,
  p_current_end_date  date,
  p_current_cycle     text,
  p_target_plan_id    uuid,
  p_target_plan_name  text,
  p_target_cycle      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_same_plan boolean;
  v_cur_tier  integer;
  v_new_tier  integer;
  v_active    boolean;
BEGIN
  v_same_plan := p_target_plan_id IS NULL AND p_target_plan_name IS NULL;

  IF NOT v_same_plan AND public.subscription_change_is_downgrade(
       p_current_plan_id, p_current_plan_name, p_current_status, p_current_end_date,
       p_target_plan_id, p_target_plan_name
     ) THEN
    RETURN true;
  END IF;

  IF p_target_cycle IS NULL OR p_current_cycle IS NULL THEN
    RETURN false;
  END IF;

  v_active := p_current_status IN ('active', 'trialing')
              AND (p_current_end_date IS NULL OR p_current_end_date >= public.subscription_today());
  IF NOT v_active THEN
    RETURN false;
  END IF;

  -- Upgrade de plano: o ciclo escolhido é livre.
  IF NOT v_same_plan THEN
    v_cur_tier := public.subscription_plan_tier(p_current_plan_id, p_current_plan_name);
    v_new_tier := public.subscription_plan_tier(p_target_plan_id, p_target_plan_name);
    IF v_cur_tier IS NOT NULL AND v_new_tier IS NOT NULL AND v_new_tier > v_cur_tier THEN
      RETURN false;
    END IF;
  END IF;

  RETURN public.subscription_cycle_days(p_target_cycle) < public.subscription_cycle_days(p_current_cycle);
END;
$$;

-- Versão com ciclo, usada pelas edge functions de pagamento.
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
DECLARE
  s record;
  v_same_plan boolean;
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_admin()
     AND NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  SELECT plan_id, plan_name, status, end_date, billing_cycle
    INTO s
    FROM public.subscriptions
   WHERE company_id = p_company_id
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_same_plan := lower(trim(COALESCE(s.plan_name, ''))) = lower(trim(COALESCE(p_target_plan, '')));

  RETURN public.subscription_change_is_downgrade(
    s.plan_id, s.plan_name, s.status, s.end_date::date, s.billing_cycle,
    NULL,
    CASE WHEN v_same_plan THEN NULL ELSE p_target_plan END,
    p_target_cycle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_change_is_downgrade(uuid, text, text, date, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_subscription_downgrade(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_change_is_downgrade(uuid, text, text, date, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_subscription_downgrade(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger: passa a verificar também a mudança de ciclo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_subscription_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_plan_id   uuid;
  v_target_plan_name text;
  v_old_active       boolean;
  v_plan_changed     boolean;
  v_cycle_changed    boolean;
BEGIN
  -- Service role (webhook / edge functions), triggers de sistema e administradores.
  IF auth.uid() IS NULL
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Não é possível eliminar a subscrição.'
      USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_DELETE_BLOCKED';
  END IF;

  -- INSERT
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

  v_old_active := OLD.status IN ('active', 'trialing')
                  AND (OLD.end_date IS NULL OR OLD.end_date::date >= public.subscription_today());

  IF v_old_active THEN
    IF NEW.status IS NULL OR NEW.status NOT IN ('active', 'trialing') THEN
      RAISE EXCEPTION 'Não é possível desactivar a subscrição enquanto o período actual estiver activo.'
        USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
    END IF;
    IF OLD.end_date IS NOT NULL AND NEW.end_date IS NOT NULL
       AND NEW.end_date::date < OLD.end_date::date THEN
      RAISE EXCEPTION 'Não é possível encurtar o período da subscrição activa.'
        USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
    END IF;
  END IF;

  v_plan_changed  := NEW.plan_name IS DISTINCT FROM OLD.plan_name
                     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id;
  v_cycle_changed := NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle;

  IF NOT v_plan_changed AND NOT v_cycle_changed THEN
    RETURN NEW;
  END IF;

  -- Plano alvo: NULL/NULL = mesmo plano; só plan_id mudou = usa o id; senão o nome.
  IF NOT v_plan_changed THEN
    v_target_plan_id   := NULL;
    v_target_plan_name := NULL;
  ELSIF NEW.plan_name IS NOT DISTINCT FROM OLD.plan_name THEN
    v_target_plan_id   := NEW.plan_id;
    v_target_plan_name := NULL;
  ELSE
    v_target_plan_id   := NULL;
    v_target_plan_name := NEW.plan_name;
  END IF;

  IF public.subscription_change_is_downgrade(
       OLD.plan_id, OLD.plan_name, OLD.status, OLD.end_date::date, OLD.billing_cycle,
       v_target_plan_id, v_target_plan_name, NEW.billing_cycle
     ) THEN
    RAISE EXCEPTION 'Não é possível fazer downgrade do plano.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
  END IF;

  RETURN NEW;
END;
$$;
