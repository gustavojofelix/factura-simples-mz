/*
  # Ponto de Venda — Fase 2: configuração

  Um estabelecimento = uma empresa (NUIT). Tudo é configurado na aplicação da
  empresa por Proprietário, Admin ou Gestor.

  1. `companies.pos_business_type` ('retail' | 'restaurant') e `pos_settings`
     (talão, papel, pagamentos activos, regras de caixa).
  2. Produtos: `product_categories` e, em `products`, categoria, visível no
     POS, estação (cozinha/bar), imagem, venda ao peso, disponível hoje.
  3. `pos_terminals`: cada caixa. É emparelhado com um código de uso único
     (`pos_create_pairing_code`); a Edge Function `pos-pair-terminal` cria
     então um utilizador técnico (app_metadata.kind = 'pos_terminal') que só
     tem acesso ao POS da sua empresa. Revogar o terminal corta o acesso.
  4. `pos_staff`: funcionários do POS (caixa, empregado de mesa, gerente), sem
     email. O PIN é guardado com bcrypt e nunca sai do servidor.
  5. `pos_zones` e `pos_tables` (restaurantes).
  6. Limites do plano: `max_pos_terminals` e `max_pos_staff` (sem linha no
     plano = sem limite).
*/

-- ---------------------------------------------------------------------------
-- 1. Empresa
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pos_business_type text NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS pos_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pos_business_type_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_pos_business_type_check CHECK (pos_business_type IN ('retail', 'restaurant'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pos_is_manager(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_company_role(p_company_id, ARRAY['owner', 'admin', 'manager']);
$$;

GRANT EXECUTE ON FUNCTION public.pos_is_manager(uuid) TO authenticated;

-- Limite do plano para o POS; NULL = sem limite (incluindo quando o plano não o define).
CREATE OR REPLACE FUNCTION public._pos_limit(p_company_id uuid, p_code text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN enabled THEN limit_value ELSE NULL END
    FROM public.subscription_feature_value(p_company_id, p_code);
$$;

-- ---------------------------------------------------------------------------
-- 2. Produtos e categorias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  color text NOT NULL DEFAULT '#f97316',
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_categories_company_name_key
  ON public.product_categories (company_id, lower(btrim(name)));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view product categories" ON public.product_categories;
CREATE POLICY "Members view product categories" ON public.product_categories
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Managers manage product categories" ON public.product_categories;
CREATE POLICY "Managers manage product categories" ON public.product_categories
  FOR ALL TO authenticated
  USING (public.pos_is_manager(company_id))
  WITH CHECK (public.pos_is_manager(company_id));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pos_station text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS sold_by_weight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_available boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pos_station_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_pos_station_check CHECK (pos_station IS NULL OR pos_station IN ('kitchen', 'bar'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category_id) WHERE category_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Terminais
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  paired_at timestamptz,
  last_seen_at timestamptz,
  user_agent text,
  revoked_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_terminals_company ON public.pos_terminals (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS pos_terminals_pairing_code_key
  ON public.pos_terminals (pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;

ALTER TABLE public.pos_terminals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers view terminals" ON public.pos_terminals;
CREATE POLICY "Managers view terminals" ON public.pos_terminals
  FOR SELECT TO authenticated USING (public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "Managers create terminals" ON public.pos_terminals;
CREATE POLICY "Managers create terminals" ON public.pos_terminals
  FOR INSERT TO authenticated WITH CHECK (public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "Managers update terminals" ON public.pos_terminals;
CREATE POLICY "Managers update terminals" ON public.pos_terminals
  FOR UPDATE TO authenticated
  USING (public.pos_is_manager(company_id))
  WITH CHECK (public.pos_is_manager(company_id));

-- Só o nome se altera directamente; o resto passa pelas funções abaixo.
REVOKE INSERT, UPDATE ON public.pos_terminals FROM authenticated;
GRANT INSERT (company_id, name) ON public.pos_terminals TO authenticated;
GRANT UPDATE (name) ON public.pos_terminals TO authenticated;
REVOKE SELECT ON public.pos_terminals FROM authenticated;
GRANT SELECT (id, company_id, name, auth_user_id, pairing_expires_at, paired_at, last_seen_at,
              user_agent, revoked_at, created_by, created_at) ON public.pos_terminals TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_pos_terminal_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit bigint := public._pos_limit(NEW.company_id, 'max_pos_terminals');
BEGIN
  IF v_limit IS NOT NULL AND (
    SELECT count(*) FROM pos_terminals WHERE company_id = NEW.company_id AND revoked_at IS NULL
  ) >= v_limit THEN
    RAISE EXCEPTION 'O limite do seu plano para terminais POS foi atingido (%).', v_limit
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_pos_terminal_limit ON public.pos_terminals;
CREATE TRIGGER enforce_pos_terminal_limit
  BEFORE INSERT ON public.pos_terminals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_terminal_limit();

/*
  Código de emparelhamento: 8 caracteres sem ambiguidades (sem 0/O, 1/I/L),
  válido 15 minutos, guardado como SHA-256. Gerar um novo código invalida o
  anterior. Devolve o código em claro uma única vez.
*/
CREATE OR REPLACE FUNCTION public.pos_create_pairing_code(p_terminal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_bytes bytea := gen_random_bytes(8);
  i integer;
BEGIN
  SELECT * INTO v_terminal FROM pos_terminals WHERE id = p_terminal_id FOR UPDATE;
  IF NOT FOUND OR NOT public.pos_is_manager(v_terminal.company_id) THEN
    RAISE EXCEPTION 'Terminal não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_terminal.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este terminal foi revogado. Crie um novo terminal.' USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..7 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  END LOOP;

  UPDATE pos_terminals
     SET pairing_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
         pairing_expires_at = now() + interval '15 minutes'
   WHERE id = p_terminal_id;

  RETURN jsonb_build_object(
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4),
    'expires_at', now() + interval '15 minutes'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_create_pairing_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_revoke_terminal(p_terminal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM pos_terminals WHERE id = p_terminal_id;
  IF v_company_id IS NULL OR NOT public.pos_is_manager(v_company_id) THEN
    RAISE EXCEPTION 'Terminal não encontrado' USING ERRCODE = 'P0002';
  END IF;
  UPDATE pos_terminals
     SET revoked_at = COALESCE(revoked_at, now()),
         pairing_code_hash = NULL,
         pairing_expires_at = NULL
   WHERE id = p_terminal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_revoke_terminal(uuid) TO authenticated;

-- Terminal da sessão actual (utilizador técnico), se não estiver revogado.
CREATE OR REPLACE FUNCTION public.pos_current_terminal()
RETURNS public.pos_terminals
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.* FROM public.pos_terminals t
   WHERE t.auth_user_id = auth.uid()
     AND t.revoked_at IS NULL
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.pos_current_terminal() FROM PUBLIC, anon;

-- Os utilizadores técnicos dos terminais não têm perfil nem conta.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
BEGIN
  -- O GoTrue grava o app_metadata num UPDATE depois do INSERT: o perfil criado
  -- na inserção é apagado quando o utilizador passa a ser um terminal.
  IF new.raw_app_meta_data->>'kind' = 'pos_terminal' THEN
    DELETE FROM public.profiles WHERE id = new.id;
    RETURN new;
  END IF;

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
$function$;

-- ---------------------------------------------------------------------------
-- 4. Funcionários
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  role text NOT NULL DEFAULT 'cashier' CHECK (role IN ('cashier', 'waiter', 'manager')),
  -- Permissões extra ou retiradas em relação ao papel (ex.: {"max_discount_pct": 10}).
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  color text NOT NULL DEFAULT '#f97316',
  pin_hash text,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_company ON public.pos_staff (company_id);

ALTER TABLE public.pos_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers view staff" ON public.pos_staff;
CREATE POLICY "Managers view staff" ON public.pos_staff
  FOR SELECT TO authenticated USING (public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "Managers create staff" ON public.pos_staff;
CREATE POLICY "Managers create staff" ON public.pos_staff
  FOR INSERT TO authenticated WITH CHECK (public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "Managers update staff" ON public.pos_staff;
CREATE POLICY "Managers update staff" ON public.pos_staff
  FOR UPDATE TO authenticated
  USING (public.pos_is_manager(company_id))
  WITH CHECK (public.pos_is_manager(company_id));

-- O hash do PIN nunca é lido nem escrito directamente.
REVOKE SELECT, INSERT, UPDATE ON public.pos_staff FROM authenticated;
GRANT SELECT (id, company_id, user_id, name, role, permissions, color, failed_attempts, locked_until,
              is_active, created_at, updated_at) ON public.pos_staff TO authenticated;
GRANT INSERT (company_id, user_id, name, role, permissions, color, is_active) ON public.pos_staff TO authenticated;
GRANT UPDATE (user_id, name, role, permissions, color, is_active) ON public.pos_staff TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_pos_staff_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit bigint;
BEGIN
  NEW.updated_at := now();
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active THEN RETURN NEW; END IF;
  v_limit := public._pos_limit(NEW.company_id, 'max_pos_staff');
  IF v_limit IS NOT NULL AND (
    SELECT count(*) FROM pos_staff WHERE company_id = NEW.company_id AND is_active AND id <> NEW.id
  ) >= v_limit THEN
    RAISE EXCEPTION 'O limite do seu plano para funcionários POS foi atingido (%).', v_limit
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_pos_staff_limit ON public.pos_staff;
CREATE TRIGGER enforce_pos_staff_limit
  BEFORE INSERT OR UPDATE ON public.pos_staff
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pos_staff_limit();

/*
  Define ou repõe o PIN (4 dígitos, como o teclado do terminal). Dois funcionários activos da mesma
  empresa não podem ter o mesmo PIN: o gerente autoriza operações só com o PIN.
  Também desbloqueia o funcionário.
*/
CREATE OR REPLACE FUNCTION public.pos_set_staff_pin(p_staff_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM pos_staff WHERE id = p_staff_id;
  IF v_company_id IS NULL OR NOT public.pos_is_manager(v_company_id) THEN
    RAISE EXCEPTION 'Funcionário não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'O PIN deve ter 4 dígitos.' USING ERRCODE = '22023';
  END IF;
  IF p_pin ~ '^(.)\1+$' OR p_pin IN ('1234', '4321', '0123', '9876') THEN
    RAISE EXCEPTION 'Este PIN é demasiado fácil. Escolha outro.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pos_staff s
     WHERE s.company_id = v_company_id
       AND s.id <> p_staff_id
       AND s.is_active
       AND s.pin_hash IS NOT NULL
       AND s.pin_hash = crypt(p_pin, s.pin_hash)
  ) THEN
    RAISE EXCEPTION 'Este PIN já está a ser usado por outro funcionário.' USING ERRCODE = '23505';
  END IF;

  UPDATE pos_staff
     SET pin_hash = crypt(p_pin, gen_salt('bf', 8)),
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = now()
   WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_set_staff_pin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_unlock_staff(p_staff_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM pos_staff WHERE id = p_staff_id;
  IF v_company_id IS NULL OR NOT public.pos_is_manager(v_company_id) THEN
    RAISE EXCEPTION 'Funcionário não encontrado' USING ERRCODE = 'P0002';
  END IF;
  UPDATE pos_staff SET failed_attempts = 0, locked_until = NULL WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_unlock_staff(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Zonas e mesas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.pos_zones(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  seats integer NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 50),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_tables_company_name_key
  ON public.pos_tables (company_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_pos_zones_company ON public.pos_zones (company_id);

ALTER TABLE public.pos_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view zones" ON public.pos_zones;
CREATE POLICY "Members view zones" ON public.pos_zones
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS "Managers manage zones" ON public.pos_zones;
CREATE POLICY "Managers manage zones" ON public.pos_zones
  FOR ALL TO authenticated
  USING (public.pos_is_manager(company_id))
  WITH CHECK (public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "Members view tables" ON public.pos_tables;
CREATE POLICY "Members view tables" ON public.pos_tables
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS "Managers manage tables" ON public.pos_tables;
CREATE POLICY "Managers manage tables" ON public.pos_tables
  FOR ALL TO authenticated
  USING (public.pos_is_manager(company_id))
  WITH CHECK (public.pos_is_manager(company_id));

-- ---------------------------------------------------------------------------
-- 6. Subscrição: os terminais seguem a tolerância do POS
-- ---------------------------------------------------------------------------
-- As escritas de um terminal (ex.: criar o cliente com NUIT numa venda) só
-- acontecem através das funções pos_*, que já verificam company_pos_access.
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

  IF EXISTS (SELECT 1 FROM public.pos_terminals WHERE auth_user_id = auth.uid() AND revoked_at IS NULL) THEN
    IF NOT COALESCE((public.company_pos_access(NEW.company_id) ->> 'allowed')::boolean, false) THEN
      RAISE EXCEPTION 'A subscrição desta empresa expirou e o período de tolerância do POS terminou. Renove o plano para continuar a vender.'
        USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_EXPIRED';
    END IF;
    RETURN NEW;
  END IF;

  -- IF aninhados: NEW.origin e NEW.is_walk_in só existem na respectiva tabela.
  IF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.origin = 'pos' THEN
      IF NOT COALESCE((public.company_pos_access(NEW.company_id) ->> 'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'A subscrição desta empresa expirou e o período de tolerância do POS terminou. Renove o plano para continuar a vender.'
          USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_EXPIRED';
      END IF;
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'clients' THEN
    IF NEW.is_walk_in THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT public.company_subscription_active(NEW.company_id) THEN
    RAISE EXCEPTION 'A subscrição desta empresa expirou. Renove o plano em Configurações → Subscrição para continuar a usar o sistema.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permissões da Data API (o Supabase deixou de as dar automaticamente)
-- ---------------------------------------------------------------------------
-- Terminais e funcionários: as colunas permitidas já foram concedidas acima
-- (o código de emparelhamento e o hash do PIN nunca são acessíveis).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_zones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_tables TO authenticated;
GRANT ALL ON public.product_categories, public.pos_zones, public.pos_tables,
             public.pos_terminals, public.pos_staff TO service_role;
