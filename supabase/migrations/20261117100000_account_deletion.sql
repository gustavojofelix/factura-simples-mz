-- Eliminação de conta (exigência da Google Play e da Política de Privacidade).
--
-- Fluxo:
--   1. Perfil → "Eliminar conta": o utilizador escreve ELIMINAR e recebe um
--      código de 6 dígitos por email (Edge Function `delete-account`).
--   2. Com o código, o pedido fica 'pending' durante 30 dias. Nesse período o
--      utilizador ainda pode entrar, mas só vê o ecrã "Conta em eliminação"
--      com a opção de cancelar.
--   3. Terminado o prazo, o job diário (pg_cron → pg_net → delete-account,
--      modo 'process') chama process_account_deletion() e depois banir/
--      anonimizar o utilizador em auth.users através da API de administração.
--
-- Porque NÃO se apaga auth.users: profiles → companies → facturas estão em
-- ON DELETE CASCADE, o que apagaria documentos fiscais que a lei obriga a
-- conservar durante 10 anos. Em vez disso os dados pessoais são anonimizados
-- e os documentos fiscais ficam, associados a uma empresa encerrada.
--
-- Empresas encerradas: status = 'suspended' (todas as rotinas automáticas —
-- lembretes fiscais, alertas de IA — já excluem empresas suspensas) e
-- closed_at preenchido. O NUIT de uma empresa encerrada pode voltar a ser
-- registado (ex.: NUIT de testes usado por quem saiu da plataforma).

-- ---------------------------------------------------------------------------
-- 1. Empresas encerradas e NUIT reutilizável
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

COMMENT ON COLUMN public.companies.closed_at IS
  'Data de encerramento (conta do dono eliminada). Os documentos fiscais são conservados 10 anos; o NUIT fica livre para novo registo.';

DROP INDEX IF EXISTS public.companies_nuit_unique;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
     WHERE nuit IS NOT NULL AND nuit <> '' AND closed_at IS NULL
     GROUP BY nuit HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS companies_nuit_unique
      ON public.companies (nuit)
      WHERE nuit IS NOT NULL AND nuit <> '' AND closed_at IS NULL;
  ELSE
    RAISE WARNING 'Há NUITs duplicados em empresas activas: o índice companies_nuit_unique não foi recriado.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_unique_company_nuit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuit text;
  v_owner text;
BEGIN
  v_nuit := regexp_replace(COALESCE(NEW.nuit, ''), '\D', '', 'g');

  IF v_nuit = '' THEN
    RETURN NEW;
  END IF;

  NEW.nuit := v_nuit;

  -- Em UPDATE, só validar se o NUIT sofreu alteração
  IF TG_OP = 'UPDATE' AND regexp_replace(COALESCE(OLD.nuit, ''), '\D', '', 'g') = v_nuit THEN
    RETURN NEW;
  END IF;

  -- Empresas encerradas (closed_at) não bloqueiam o NUIT.
  SELECT c.name INTO v_owner
    FROM public.companies c
   WHERE regexp_replace(COALESCE(c.nuit, ''), '\D', '', 'g') = v_nuit
     AND c.id IS DISTINCT FROM NEW.id
     AND c.closed_at IS NULL
   LIMIT 1;

  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe uma entidade registada com o NUIT %.', v_nuit
      USING ERRCODE = 'P0001', DETAIL = 'DUPLICATE_COMPANY_NUIT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_company_nuit_available(
  p_nuit text,
  p_exclude_company_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.companies c
     WHERE regexp_replace(COALESCE(c.nuit, ''), '\D', '', 'g')
           = regexp_replace(COALESCE(p_nuit, ''), '\D', '', 'g')
       AND regexp_replace(COALESCE(p_nuit, ''), '\D', '', 'g') <> ''
       AND c.closed_at IS NULL
       AND (p_exclude_company_id IS NULL OR c.id <> p_exclude_company_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_company_nuit_available(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Nome do emissor guardado no documento
-- ---------------------------------------------------------------------------
-- Enquanto o utilizador existe, a interface mostra o nome actual do perfil.
-- Quando a conta é eliminada, o nome é copiado para cada factura que emitiu
-- ANTES de o perfil ser anonimizado: o documento fiscal não muda de emissor.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issuer_name text;

COMMENT ON COLUMN public.invoices.issuer_name IS
  'Nome do emissor congelado no documento (preenchido quando a conta do emissor é eliminada).';

-- ---------------------------------------------------------------------------
-- 3. Pedidos de eliminação
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'awaiting_code'
    CHECK (status IN ('awaiting_code', 'pending', 'cancelled', 'completed', 'failed')),
  -- Código de confirmação (só o hash; nunca exposto ao cliente).
  code_hash text,
  code_sent_at timestamptz,
  code_expires_at timestamptz,
  code_attempts int NOT NULL DEFAULT 0,
  -- Pedido confirmado / prazo de carência.
  requested_at timestamptz,
  scheduled_for timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No máximo um pedido em aberto por utilizador.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_open_key
  ON public.account_deletion_requests (user_id)
  WHERE status IN ('awaiting_code', 'pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_due
  ON public.account_deletion_requests (scheduled_for)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Users view own deletion requests" ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Escrita só pela Edge Function (service role). O cliente lê apenas as colunas
-- de estado — o hash do código fica de fora.
REVOKE ALL ON public.account_deletion_requests FROM anon, authenticated;
GRANT SELECT (id, user_id, status, requested_at, scheduled_for, cancelled_at, completed_at, created_at)
  ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;

DROP TRIGGER IF EXISTS update_account_deletion_requests_updated_at ON public.account_deletion_requests;
CREATE TRIGGER update_account_deletion_requests_updated_at
  BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. Anonimização (chamada pela Edge Function, só com service role)
-- ---------------------------------------------------------------------------
-- Idempotente: pode voltar a correr se a parte de auth.users falhar.
-- Devolve o email anónimo a gravar em auth.users e os utilizadores dos
-- terminais POS a apagar.
CREATE OR REPLACE FUNCTION public.process_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anon_email text := p_user_id::text || '@deleted.ispcfacil.com';
  v_company_ids uuid[];
  v_pos_users uuid[];
  v_full_name text;
  v_auth_cleanup text := 'ok';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilizador em falta.';
  END IF;

  SELECT full_name INTO v_full_name FROM profiles WHERE id = p_user_id;

  -- a) Congelar o nome do emissor nas facturas (sem mexer em updated_at, que
  --    o SAF-T usa como data de anulação de recurso).
  IF v_full_name IS NOT NULL AND v_full_name <> 'Utilizador eliminado' THEN
    ALTER TABLE public.invoices DISABLE TRIGGER update_invoices_updated_at;
    UPDATE invoices
       SET issuer_name = v_full_name
     WHERE created_by = p_user_id
       AND issuer_name IS NULL;
    ALTER TABLE public.invoices ENABLE TRIGGER update_invoices_updated_at;
  END IF;

  -- b) Empresas do utilizador: encerradas (documentos conservados).
  SELECT COALESCE(array_agg(id), '{}') INTO v_company_ids
    FROM companies WHERE user_id = p_user_id;

  UPDATE companies
     SET status = 'suspended',
         closed_at = COALESCE(closed_at, now())
   WHERE id = ANY (v_company_ids);

  -- Terminais POS dessas empresas: revogados (os utilizadores auth são
  -- apagados pela Edge Function).
  SELECT COALESCE(array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), '{}')
    INTO v_pos_users
    FROM pos_terminals WHERE company_id = ANY (v_company_ids);

  UPDATE pos_terminals
     SET revoked_at = COALESCE(revoked_at, now()),
         pairing_code_hash = NULL,
         pairing_expires_at = NULL
   WHERE company_id = ANY (v_company_ids);

  -- Ninguém mais acede às empresas encerradas; e o utilizador sai de todas
  -- as empresas de terceiros onde era membro.
  DELETE FROM company_users
   WHERE company_id = ANY (v_company_ids)
      OR user_id = p_user_id;

  -- c) Conta (subdomínio): suspensa e com o slug libertado.
  UPDATE accounts
     SET status = 'suspended',
         name = NULL,
         slug = 'eliminada-' || substr(md5(id::text), 1, 12)
   WHERE owner_user_id = p_user_id
     AND slug NOT LIKE 'eliminada-%';

  -- d) Dados pessoais sem valor fiscal.
  DELETE FROM ai_conversations WHERE user_id = p_user_id;

  UPDATE profiles
     SET full_name = 'Utilizador eliminado',
         phone = NULL,
         email = v_anon_email,
         language = NULL,
         status = 'suspended',
         updated_at = now()
   WHERE id = p_user_id;

  -- e) Sessões e identidades externas (Google): sem identidade, um novo login
  --    com a mesma conta Google cria um utilizador novo.
  BEGIN
    DELETE FROM auth.identities WHERE user_id = p_user_id AND provider <> 'email';
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  EXCEPTION WHEN OTHERS THEN
    v_auth_cleanup := SQLERRM;
  END;

  RETURN jsonb_build_object(
    'anon_email', v_anon_email,
    'company_ids', to_jsonb(v_company_ids),
    'pos_auth_user_ids', to_jsonb(v_pos_users),
    'auth_cleanup', v_auth_cleanup
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_account_deletion(uuid) FROM public;
REVOKE ALL ON FUNCTION public.process_account_deletion(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_account_deletion(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Agendamento diário (pg_cron + pg_net → delete-account, modo 'process')
-- ---------------------------------------------------------------------------
-- Usa os mesmos segredos do Vault que os lembretes fiscais
-- ('project_url' e 'cron_secret').
CREATE OR REPLACE FUNCTION public.dispatch_account_deletions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_deletion_requests
     WHERE status IN ('pending', 'failed') AND scheduled_for <= now()
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1$q$
      INTO v_url;
    EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1$q$
      INTO v_secret;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_url := COALESCE(NULLIF(v_url, ''), NULLIF(current_setting('app.settings.supabase_url', true), ''));
  v_secret := COALESCE(NULLIF(v_secret, ''), NULLIF(current_setting('app.settings.cron_secret', true), ''));

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'delete-account: falta project_url ou cron_secret (Vault ou app.settings).';
    RETURN NULL;
  END IF;

  EXECUTE
    'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 120000)'
    INTO v_request_id
    USING rtrim(v_url, '/') || '/functions/v1/delete-account',
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          '{"action":"process"}'::jsonb;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'delete-account: falha ao invocar a Edge Function (%).', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_account_deletions() FROM public;
REVOKE ALL ON FUNCTION public.dispatch_account_deletions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_account_deletions() TO service_role;

-- 03:00 UTC = 05:00 em Maputo.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule('eliminacao-contas-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eliminacao-contas-diario');

  PERFORM cron.schedule(
    'eliminacao-contas-diario',
    '0 3 * * *',
    'SELECT public.dispatch_account_deletions();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível (%). Agende um POST diário para /functions/v1/delete-account com {"action":"process"} e o cabeçalho x-cron-secret.', SQLERRM;
END $$;
