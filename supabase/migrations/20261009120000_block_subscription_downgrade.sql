-- Bloquear o downgrade do plano de subscrição.
--
-- Regras:
--   * Cada plano tem um nível explícito (tier), editável no painel de admin.
--     O nível é independente da ordem de exibição (sort_order) e do preço.
--   * Enquanto a subscrição actual estiver activa (status active/trialing e
--     end_date >= hoje) não é possível mudar para um plano de nível inferior.
--   * Depois de expirada, qualquer plano pago pode ser escolhido.
--   * Passar de um plano pago para um plano gratuito (Trial) é sempre bloqueado.
--   * Planos do mesmo nível (ex.: Profissional <-> Standard) e mudanças apenas
--     de ciclo de facturação no mesmo plano são permitidas.
--   * Administradores da plataforma (is_admin()) e o service role (webhook,
--     edge functions) não são bloqueados pelo trigger.

-- ---------------------------------------------------------------------------
-- 1. Nível do plano
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'subscription_plans'
       AND column_name  = 'tier'
  ) THEN
    ALTER TABLE public.subscription_plans ADD COLUMN tier smallint NOT NULL DEFAULT 0;

    UPDATE public.subscription_plans
       SET tier = CASE lower(trim(code))
                    WHEN 'trial'        THEN 0
                    WHEN 'essencial'    THEN 10
                    WHEN 'profissional' THEN 20
                    WHEN 'standard'     THEN 20
                    ELSE LEAST(GREATEST(COALESCE(sort_order, 0), 0) * 10, 32000)
                  END;
  END IF;
END $$;

COMMENT ON COLUMN public.subscription_plans.tier IS
  'Nível do plano usado para bloquear downgrade (maior = superior). Planos com o mesmo nível são equivalentes.';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Devolve o nível de um plano (por id, depois por código/nome). NULL se desconhecido.
CREATE OR REPLACE FUNCTION public.subscription_plan_tier(p_plan_id uuid, p_plan_name text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.tier::integer
       FROM public.subscription_plans p
      WHERE p_plan_name IS NOT NULL
        AND (lower(trim(p.code)) = lower(trim(p_plan_name))
             OR lower(trim(p.name)) = lower(trim(p_plan_name)))
      ORDER BY p.is_active DESC
      LIMIT 1),
    (SELECT p.tier::integer FROM public.subscription_plans p WHERE p.id = p_plan_id)
  );
$$;

-- Preço mensal de um plano (por código/nome, depois por id). NULL se desconhecido.
CREATE OR REPLACE FUNCTION public.subscription_plan_monthly_price(p_plan_id uuid, p_plan_name text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.monthly_price
       FROM public.subscription_plans p
      WHERE p_plan_name IS NOT NULL
        AND (lower(trim(p.code)) = lower(trim(p_plan_name))
             OR lower(trim(p.name)) = lower(trim(p_plan_name)))
      ORDER BY p.is_active DESC
      LIMIT 1),
    (SELECT p.monthly_price FROM public.subscription_plans p WHERE p.id = p_plan_id)
  );
$$;

-- "Hoje" no fuso de Moçambique (o servidor corre em UTC). A interface usa a
-- mesma data, para que o cliente e o servidor concordem sobre a expiração.
CREATE OR REPLACE FUNCTION public.subscription_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'Africa/Maputo')::date;
$$;

-- Núcleo da regra: mudar de (plano actual, estado) para o plano alvo é downgrade?
-- Planos desconhecidos (NULL) nunca são tratados como downgrade.
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
  v_active     boolean;
BEGIN
  v_cur_tier  := public.subscription_plan_tier(p_current_plan_id, p_current_plan_name);
  v_new_tier  := public.subscription_plan_tier(p_target_plan_id, p_target_plan_name);
  v_cur_price := public.subscription_plan_monthly_price(p_current_plan_id, p_current_plan_name);
  v_new_price := public.subscription_plan_monthly_price(p_target_plan_id, p_target_plan_name);

  -- Plano pago -> plano gratuito: sempre bloqueado (mesmo depois de expirar).
  IF COALESCE(v_cur_price, 0) > 0 AND v_new_price IS NOT NULL AND v_new_price = 0 THEN
    RETURN true;
  END IF;

  v_active := p_current_status IN ('active', 'trialing')
              AND (p_current_end_date IS NULL OR p_current_end_date >= public.subscription_today());

  IF NOT v_active OR v_cur_tier IS NULL OR v_new_tier IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_new_tier < v_cur_tier;
END;
$$;

-- Verifica se a mudança da subscrição de uma empresa para p_target_plan é downgrade.
-- Usada pelas edge functions (service role). Um utilizador autenticado só pode
-- consultar empresas de que é membro (ou ser administrador da plataforma).
CREATE OR REPLACE FUNCTION public.is_subscription_downgrade(p_company_id uuid, p_target_plan text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_admin()
     AND NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  SELECT plan_id, plan_name, status, end_date
    INTO s
    FROM public.subscriptions
   WHERE company_id = p_company_id
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN public.subscription_change_is_downgrade(
    s.plan_id, s.plan_name, s.status, s.end_date::date, NULL, p_target_plan
  );
END;
$$;

-- Nível e preço do plano actual da empresa, mesmo que o plano tenha sido
-- desactivado (a RLS de subscription_plans só mostra planos activos aos
-- clientes). Permite à interface aplicar a mesma regra que o servidor.
CREATE OR REPLACE FUNCTION public.get_company_plan_level(p_company_id uuid)
RETURNS TABLE (plan_name text, tier integer, monthly_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_admin() OR public.is_company_member(p_company_id)) THEN
    RETURN;
  END IF;

  SELECT sub.plan_id, sub.plan_name
    INTO s
    FROM public.subscriptions sub
   WHERE sub.company_id = p_company_id
   ORDER BY sub.updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  plan_name     := s.plan_name;
  tier          := public.subscription_plan_tier(s.plan_id, s.plan_name);
  monthly_price := public.subscription_plan_monthly_price(s.plan_id, s.plan_name);
  RETURN NEXT;
END;
$$;

-- Os helpers são SECURITY DEFINER e, por omissão, o PUBLIC pode executá-los;
-- por isso o acesso é restringido explicitamente. O trigger (SECURITY DEFINER)
-- não precisa destas permissões.
REVOKE ALL ON FUNCTION public.subscription_plan_tier(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_plan_monthly_price(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_change_is_downgrade(uuid, text, text, date, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_subscription_downgrade(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_plan_level(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.subscription_today() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscription_plan_tier(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_plan_monthly_price(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_change_is_downgrade(uuid, text, text, date, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_subscription_downgrade(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_plan_level(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger nas subscrições (cobre escritas directas do dono via REST)
-- ---------------------------------------------------------------------------
-- O dono da empresa ainda tem políticas RLS de INSERT/UPDATE/DELETE em
-- subscriptions (a activação com voucher a 100% e os planos gratuitos são
-- escritos pelo browser). Para que o bloqueio não possa ser contornado:
--   * DELETE: proibido ao dono (excepto em cascata, ex.: eliminar a empresa);
--   * INSERT: só quando a empresa ainda não tem subscrição;
--   * UPDATE de uma subscrição activa: não pode desactivá-la (status),
--     encurtar o período (end_date), mudar de empresa, nem baixar de plano.
--     Assim não é possível "expirar" a subscrição primeiro e depois baixar o plano.
-- O nome do trigger ordena antes de trg_set_subscription_plan_id, por isso o
-- plano alvo é resolvido a partir de NEW.plan_name (o plan_id ainda pode estar
-- desactualizado neste momento).
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

DROP TRIGGER IF EXISTS trg_prevent_subscription_downgrade ON public.subscriptions;
CREATE TRIGGER trg_prevent_subscription_downgrade
  BEFORE INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_subscription_downgrade();
