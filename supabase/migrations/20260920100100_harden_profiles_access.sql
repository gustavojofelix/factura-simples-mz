-- Endurecimento do acesso a `profiles`.
--
-- Estado anterior:
--   * profiles_select usava USING (true) — qualquer utilizador autenticado lia
--     o nome, email, telefone, papel e estado de TODOS os subscritores da
--     plataforma.
--   * profiles_update permitia ao utilizador alterar a sua própria linha sem
--     qualquer restrição de coluna, incluindo `role`. Bastava um PATCH em
--     /rest/v1/profiles para obter acesso de administrador.
--
-- As funções abaixo são SECURITY DEFINER e correm como dono das tabelas, pelo
-- que não reentram no RLS de `profiles` nem de `company_users` — é isso que
-- evita a recursão infinita (42P17) que motivou as migrações anteriores.

-- ── Quem pode ver que perfil ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- O próprio
    p_profile_id = (SELECT auth.uid())
    -- Administradores da plataforma (back office)
    OR COALESCE(
         (SELECT role = 'admin' FROM public.profiles WHERE id = (SELECT auth.uid())),
         false
       )
    -- Colegas: alguém com quem partilho pelo menos uma empresa
    OR EXISTS (
         SELECT 1
           FROM public.company_users mine
           JOIN public.company_users theirs ON theirs.company_id = mine.company_id
          WHERE mine.user_id = (SELECT auth.uid())
            AND theirs.user_id = p_profile_id
       )
    -- Proprietário de uma empresa a que o perfil pertence, e vice-versa
    OR EXISTS (
         SELECT 1
           FROM public.companies c
           JOIN public.company_users cu ON cu.company_id = c.id
          WHERE (c.user_id = (SELECT auth.uid()) AND cu.user_id = p_profile_id)
             OR (c.user_id = p_profile_id AND cu.user_id = (SELECT auth.uid()))
       );
$$;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.can_view_profile(id));

-- ── Impedir auto-promoção ───────────────────────────────────────────────────
-- `role` e `status` só podem ser alterados por um administrador da plataforma
-- ou por processos de servidor (service role, onde auth.uid() é NULL).
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_actor_is_admin boolean;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Contexto de servidor (migrações, funções edge com service role).
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(role = 'admin', false) INTO v_actor_is_admin
    FROM public.profiles WHERE id = v_actor;

  IF COALESCE(v_actor_is_admin, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Não tem permissão para alterar o papel de um utilizador.'
      USING ERRCODE = 'P0001', DETAIL = 'FORBIDDEN_ROLE_CHANGE';
  END IF;

  RAISE EXCEPTION 'Não tem permissão para alterar o estado de um utilizador.'
    USING ERRCODE = 'P0001', DETAIL = 'FORBIDDEN_STATUS_CHANGE';
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profiles_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- Um perfil novo nunca nasce administrador por iniciativa do cliente.
CREATE OR REPLACE FUNCTION public.guard_profile_insert_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(
       (SELECT role = 'admin' FROM public.profiles WHERE id = (SELECT auth.uid())),
       false
     ) THEN
    RETURN NEW;
  END IF;

  NEW.role := 'user';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_insert_role ON public.profiles;
CREATE TRIGGER guard_profiles_insert_role
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_insert_role();

GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO authenticated;
