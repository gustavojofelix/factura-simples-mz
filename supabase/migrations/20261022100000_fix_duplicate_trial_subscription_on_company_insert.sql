-- Corrige "A empresa já tem uma subscrição" (SUBSCRIPTION_INSERT_BLOCKED) ao
-- criar uma empresa. Em produção há mais do que um trigger AFTER INSERT em
-- companies a provisionar a subscrição Trial (create_company_owner e o antigo
-- add_company_owner). O segundo INSERT passou a ser bloqueado por
-- prevent_subscription_downgrade (20261009120000), o que abortava todo o
-- INSERT da empresa.
--
-- 1. prevent_subscription_downgrade: um INSERT vindo de outro trigger
--    (pg_trigger_depth() > 1) com subscrição já existente é ignorado
--    silenciosamente. O INSERT directo do utilizador continua bloqueado.
-- 2. Remove triggers em companies que chamam add_company_owner(), cujo
--    trabalho já é feito por create_company_owner().

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
    -- Eliminações em cascata (ex.: a empresa foi eliminada) correm dentro do
    -- trigger da chave estrangeira.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Não é possível eliminar a subscrição.'
      USING ERRCODE = '42501', DETAIL = 'SUBSCRIPTION_DELETE_BLOCKED';
  END IF;

  -- INSERT
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.company_id) THEN
      -- Inserções feitas por outro trigger (provisionamento ao criar a empresa)
      -- não são do utilizador: se a subscrição já existe, ignora a duplicada
      -- em vez de abortar a criação da empresa.
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

  -- Sem mudança efectiva de plano.
  IF NEW.plan_name IS NOT DISTINCT FROM OLD.plan_name
     AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  -- Se apenas o plan_id mudou, usa-o; caso contrário resolve pelo nome.
  IF NEW.plan_name IS NOT DISTINCT FROM OLD.plan_name THEN
    v_target_plan_id   := NEW.plan_id;
    v_target_plan_name := NULL;
  ELSE
    v_target_plan_id   := NULL;
    v_target_plan_name := NEW.plan_name;
  END IF;

  IF public.subscription_change_is_downgrade(
       OLD.plan_id, OLD.plan_name, OLD.status, OLD.end_date::date,
       v_target_plan_id, v_target_plan_name
     ) THEN
    RAISE EXCEPTION 'Não é possível fazer downgrade do plano enquanto a subscrição actual estiver activa.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_DOWNGRADE_BLOCKED';
  END IF;

  RETURN NEW;
END;
$$;


DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.companies'::regclass
       AND NOT t.tgisinternal
       AND p.proname = 'add_company_owner'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.companies', r.tgname);
    RAISE NOTICE 'Removido trigger duplicado % em companies', r.tgname;
  END LOOP;
END;
$$;
