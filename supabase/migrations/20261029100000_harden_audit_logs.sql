-- Endurecimento do registo de auditoria.
--
-- Estado anterior:
--   * A política de INSERT só exigia auth.uid() IS NOT NULL. Qualquer
--     utilizador autenticado podia escrever linhas com o user_id, user_email,
--     company_id, created_at ou ip_address que quisesse — entradas falsas no
--     registo de outra empresa, ou em nome de outra pessoa.
--   * O IP era o que o browser dizia ser (obtido via api.ipify.org).
--   * Tentativas de login falhadas não ficavam registadas (o utilizador ainda
--     não está autenticado, logo o INSERT era recusado).
--   * Os proprietários não viam os logins/logouts dos seus utilizadores, porque
--     esses eventos não têm empresa associada.

-- ── IP do pedido, lido dos cabeçalhos que o PostgREST expõe ─────────────────
CREATE OR REPLACE FUNCTION public.audit_request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_headers json;
  v_ip text;
BEGIN
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_headers IS NULL THEN
    RETURN NULL;
  END IF;

  -- x-forwarded-for pode trazer uma cadeia "cliente, proxy1, proxy2".
  v_ip := COALESCE(
    NULLIF(trim(split_part(v_headers->>'x-forwarded-for', ',', 1)), ''),
    NULLIF(v_headers->>'cf-connecting-ip', ''),
    NULLIF(v_headers->>'x-real-ip', '')
  );
  RETURN v_ip;
END;
$$;

-- ── Carimbo do servidor: quem, quando e de onde ─────────────────────────────
-- Num pedido autenticado, os campos de identidade vêm sempre da sessão e não
-- do que o cliente enviou. Em contexto de servidor (service role, webhooks,
-- migrações) auth.uid() é NULL e os valores enviados são mantidos.
CREATE OR REPLACE FUNCTION public.audit_logs_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ip text := public.audit_request_ip();
BEGIN
  NEW.created_at := now();

  IF v_ip IS NOT NULL THEN
    NEW.ip_address := v_ip;
  ELSIF v_uid IS NOT NULL THEN
    NEW.ip_address := NULL;
  END IF;

  IF v_uid IS NOT NULL THEN
    NEW.user_id := v_uid;
    NEW.user_email := (SELECT email FROM auth.users WHERE id = v_uid);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_stamp ON public.audit_logs;
CREATE TRIGGER audit_logs_stamp
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_stamp();

-- ── Só se escreve no registo das empresas a que se pertence ─────────────────
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      company_id IS NULL
      OR public.is_admin()
      OR public.is_company_member(company_id)
      -- Proprietário logo após criar a empresa, antes de existir company_users.
      OR EXISTS (
        SELECT 1 FROM public.companies c
         WHERE c.id = audit_logs.company_id
           AND c.user_id = (SELECT auth.uid())
      )
    )
  );

-- ── Proprietários/administradores vêem os acessos dos seus utilizadores ─────
DROP POLICY IF EXISTS "Company admins can view auth logs of their members" ON public.audit_logs;
CREATE POLICY "Company admins can view auth logs of their members" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    category = 'auth'
    AND company_id IS NULL
    AND user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.company_users mine
        JOIN public.company_users theirs ON theirs.company_id = mine.company_id
       WHERE mine.user_id = (SELECT auth.uid())
         AND mine.role IN ('owner', 'admin')
         AND theirs.user_id = audit_logs.user_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_audit_logs_category_user_created
  ON public.audit_logs (category, user_id, created_at DESC);

-- ── Tentativas de login falhadas ────────────────────────────────────────────
-- Chamado sem sessão (anon). A acção e a categoria são fixas e há um limite por
-- IP, para que a função não sirva para encher o registo.
CREATE OR REPLACE FUNCTION public.log_failed_login(p_email text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip text := public.audit_request_ip();
  v_email text := lower(trim(left(COALESCE(p_email, ''), 254)));
  v_recent int;
BEGIN
  IF v_email = '' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.audit_logs
   WHERE category = 'auth'
     AND action = 'Tentativa de Login Falhada'
     AND created_at > now() - interval '10 minutes'
     AND (ip_address IS NOT DISTINCT FROM v_ip OR user_email = v_email);

  IF v_recent >= 10 THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, company_id, action, category, ip_address, details)
  VALUES (
    NULL,
    v_email,
    NULL,
    'Tentativa de Login Falhada',
    'auth',
    v_ip,
    jsonb_strip_nulls(jsonb_build_object('email', v_email, 'reason', left(p_reason, 120)))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_failed_login(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.log_failed_login(text, text) TO anon, authenticated;
