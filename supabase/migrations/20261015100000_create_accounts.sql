-- Contas (tenants): cada subscritor tem uma conta com subdomínio próprio
-- (<slug>.ispcfacil.com) que agrupa as suas empresas. A subscrição continua
-- por empresa; a conta controla apenas o limite de empresas (max_companies).

-- 1. Slugs reservados ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserved_account_slugs (
  slug text PRIMARY KEY
);

INSERT INTO public.reserved_account_slugs (slug) VALUES
  ('www'), ('admin'), ('api'), ('app'), ('mail'), ('smtp'), ('suporte'),
  ('help'), ('static'), ('cdn'), ('dev'), ('staging'), ('entrar'), ('registar'),
  ('conta'), ('contas'), ('painel'), ('ispcfacil'), ('blog'), ('status')
ON CONFLICT DO NOTHING;

ALTER TABLE public.reserved_account_slugs ENABLE ROW LEVEL SECURITY;

-- 2. Tabela accounts ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$'),
  name text,
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- 3. Helpers de slug ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slugify_account(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT left(
    trim(BOTH '-' FROM regexp_replace(
      translate(
        lower(coalesce(p_text, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', '-', 'g'
    )),
    32
  );
$$;

-- Devolve um slug livre a partir de uma base, acrescentando -2, -3, ...
CREATE OR REPLACE FUNCTION public.next_free_account_slug(p_base text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text := trim(BOTH '-' FROM public.slugify_account(p_base));
  v_candidate text;
  v_n int := 1;
BEGIN
  IF v_base IS NULL OR length(v_base) < 3 THEN
    v_base := 'conta' || CASE WHEN coalesce(v_base, '') = '' THEN '' ELSE '-' || v_base END;
  END IF;
  v_base := trim(BOTH '-' FROM left(v_base, 28));
  v_candidate := v_base;

  WHILE EXISTS (SELECT 1 FROM public.accounts WHERE slug = v_candidate)
     OR EXISTS (SELECT 1 FROM public.reserved_account_slugs WHERE slug = v_candidate) LOOP
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  END LOOP;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_account_slug_available(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$'
     AND NOT EXISTS (SELECT 1 FROM public.reserved_account_slugs r WHERE r.slug = p_slug)
     AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.slug = p_slug);
$$;

-- 4. Coluna companies.account_id + backfill -----------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_companies_account_id ON public.companies(account_id);

DO $$
DECLARE
  r record;
  v_account_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.user_id) c.user_id, c.name
      FROM public.companies c
      JOIN auth.users u ON u.id = c.user_id
     WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.owner_user_id = c.user_id)
     ORDER BY c.user_id, c.created_at ASC
  LOOP
    INSERT INTO public.accounts (slug, name, owner_user_id)
    VALUES (public.next_free_account_slug(r.name), r.name, r.user_id)
    RETURNING id INTO v_account_id;
  END LOOP;

  UPDATE public.companies c
     SET account_id = a.id
    FROM public.accounts a
   WHERE a.owner_user_id = c.user_id
     AND c.account_id IS NULL;
END $$;

ALTER TABLE public.companies ALTER COLUMN account_id SET NOT NULL;

-- 5. Funções de acesso --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_account_owner(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = p_account_id AND a.owner_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_owner(p_account_id)
      OR EXISTS (
        SELECT 1
          FROM public.company_users cu
          JOIN public.companies c ON c.id = cu.company_id
         WHERE c.account_id = p_account_id
           AND cu.user_id = auth.uid()
           AND cu.is_active = true
      );
$$;

-- Contas a que o utilizador autenticado tem acesso.
CREATE OR REPLACE FUNCTION public.get_my_accounts()
RETURNS TABLE (id uuid, slug text, name text, status text, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.slug, a.name, a.status, (a.owner_user_id = auth.uid()) AS is_owner
    FROM public.accounts a
   WHERE a.owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
          FROM public.company_users cu
          JOIN public.companies c ON c.id = cu.company_id
         WHERE c.account_id = a.id
           AND cu.user_id = auth.uid()
           AND cu.is_active = true
      )
   ORDER BY (a.owner_user_id = auth.uid()) DESC, a.created_at ASC;
$$;

-- Informação pública mínima para a página de login do subdomínio.
CREATE OR REPLACE FUNCTION public.resolve_account_by_slug(p_slug text)
RETURNS TABLE (id uuid, name text, logo_url text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         a.name,
         (SELECT c.logo_url FROM public.companies c
           WHERE c.account_id = a.id
           ORDER BY c.created_at ASC LIMIT 1),
         a.status
    FROM public.accounts a
   WHERE a.slug = lower(p_slug);
$$;

-- Cria a conta do utilizador autenticado (ex.: convidado que passa a ter empresas próprias).
CREATE OR REPLACE FUNCTION public.create_account(p_slug text, p_name text)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_account FROM public.accounts WHERE owner_user_id = auth.uid();
  IF FOUND THEN
    RETURN v_account;
  END IF;

  IF NOT public.is_account_slug_available(lower(p_slug)) THEN
    RAISE EXCEPTION 'O endereço "%" não está disponível.', p_slug
      USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_SLUG_UNAVAILABLE';
  END IF;

  INSERT INTO public.accounts (slug, name, owner_user_id)
  VALUES (lower(p_slug), nullif(trim(p_name), ''), auth.uid())
  RETURNING * INTO v_account;

  RETURN v_account;
END;
$$;

-- 6. RLS de accounts ----------------------------------------------------------
DROP POLICY IF EXISTS "accounts_select" ON public.accounts;
CREATE POLICY "accounts_select" ON public.accounts
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_account_member(id) OR public.is_admin());

DROP POLICY IF EXISTS "accounts_update_owner" ON public.accounts;
CREATE POLICY "accounts_update_owner" ON public.accounts
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_user_id = auth.uid() OR public.is_admin());

-- Só o nome é editável pelo dono; slug/dono/estado ficam reservados a admins.
CREATE OR REPLACE FUNCTION public.guard_account_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Apenas o nome da conta pode ser alterado.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_account_columns ON public.accounts;
CREATE TRIGGER guard_account_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_columns();

-- 7. handle_new_user: cria a conta quando o registo traz account_slug ---------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_slug text;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    updated_at = now();

  -- Convidados (invite-user / admin-create-user) não trazem account_slug.
  v_slug := lower(nullif(trim(new.raw_user_meta_data->>'account_slug'), ''));
  IF v_slug IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE owner_user_id = new.id) THEN
    IF NOT public.is_account_slug_available(v_slug) THEN
      v_slug := public.next_free_account_slug(v_slug);
    END IF;
    INSERT INTO public.accounts (slug, name, owner_user_id)
    VALUES (
      v_slug,
      COALESCE(nullif(trim(new.raw_user_meta_data->>'account_name'), ''),
               new.raw_user_meta_data->>'full_name'),
      new.id
    )
    ON CONFLICT (owner_user_id) DO NOTHING;
  END IF;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Prevent auth failures (Database error granting user) if syncing profile fails
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Empresas: associar à conta do dono ---------------------------------------
-- O nome garante que corre antes de enforce_company_subscription_limit
-- (os triggers BEFORE correm por ordem alfabética).
CREATE OR REPLACE FUNCTION public.assign_company_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.account_id IS NULL THEN
    SELECT id INTO NEW.account_id FROM public.accounts WHERE owner_user_id = NEW.user_id;
  END IF;

  -- Back-office: empresa criada para um subscritor que ainda não tem conta.
  IF NEW.account_id IS NULL AND (auth.role() = 'service_role' OR public.is_admin()) THEN
    INSERT INTO public.accounts (slug, name, owner_user_id)
    VALUES (public.next_free_account_slug(NEW.name), NEW.name, NEW.user_id)
    RETURNING id INTO NEW.account_id;
  END IF;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'É necessário criar uma conta antes de registar empresas.'
      USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_REQUIRED';
  END IF;

  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id = NEW.account_id;
  IF v_owner IS DISTINCT FROM NEW.user_id
     AND NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Apenas o titular da conta pode criar empresas nesta conta.'
      USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_company_account ON public.companies;
CREATE TRIGGER assign_company_account
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.assign_company_account();

-- Impede mover empresas entre contas fora do back-office.
CREATE OR REPLACE FUNCTION public.guard_company_account_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     AND NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Não é possível mudar a empresa de conta.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_company_account_change ON public.companies;
CREATE TRIGGER guard_company_account_change
  BEFORE UPDATE OF account_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_account_change();

-- 9. Limite de empresas por conta ---------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_plan_for_account_id(p_account_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.subscription_plan_for_company(c.id)
       FROM public.companies c
      WHERE c.account_id = p_account_id
      ORDER BY c.created_at ASC LIMIT 1),
    (SELECT p.id FROM public.subscription_plans p WHERE p.code = 'trial' LIMIT 1)
  );
$$;

-- Mantida por compatibilidade: resolve via a conta do utilizador.
CREATE OR REPLACE FUNCTION public.subscription_plan_for_account(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.subscription_plan_for_account_id(
    (SELECT a.id FROM public.accounts a WHERE a.owner_user_id = p_user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_company_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan uuid;
  v_enabled boolean;
  v_limit bigint;
  v_count bigint;
BEGIN
  -- Backoffice administrators may provision data administratively.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  v_plan := public.subscription_plan_for_account_id(NEW.account_id);
  SELECT pf.enabled, pf.limit_value INTO v_enabled, v_limit
    FROM public.subscription_plan_features pf
    JOIN public.subscription_features f ON f.id = pf.feature_id
   WHERE pf.plan_id = v_plan AND f.code = 'max_companies';

  v_count := (SELECT count(*) FROM public.companies WHERE account_id = NEW.account_id);
  IF COALESCE(v_enabled, false) = false THEN
    RAISE EXCEPTION 'O seu plano não permite criar empresas adicionais.' USING ERRCODE = 'P0001';
  END IF;
  IF v_limit IS NOT NULL AND v_count + 1 > v_limit THEN
    RAISE EXCEPTION 'O limite de empresas do seu plano foi atingido (%).', v_limit USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- 10. Permissões --------------------------------------------------------------
GRANT SELECT, UPDATE ON public.accounts TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_slug_available(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account_by_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_account(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.next_free_account_slug(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, anon, authenticated, service_role;
