/*
  # Ponto de Venda — Fase 3: vendas, caixa e pagamentos

  O terminal (utilizador técnico emparelhado) chama apenas as funções `pos_*`
  abaixo. Cada operação leva o token do operador, obtido com o PIN
  (`pos_operator_login`). Totais, preços, descontos e trocos são calculados
  aqui, nunca confiando nos valores do browser.

  1. Operadores: `pos_operator_sessions` (token com hash, expira em 12 h).
     5 PIN errados bloqueiam o funcionário 5 minutos.
  2. Permissões por papel:
       cashier  vender, abrir/fechar caixa, relatório X
       waiter   pedidos de mesa; cobrar só com permissions.can_charge
       manager  tudo
     Desconto até permissions.max_discount_pct sem autorização. O que não é
     permitido pede o PIN de um gerente (erro com DETAIL 'POS_AUTH_REQUIRED');
     cada autorização fica em `pos_authorizations`.
  3. Caixa: `pos_sessions` (uma aberta por terminal), `pos_cash_movements`.
     O fecho grava o resumo (Z) e exige gerente acima da tolerância.
  4. Documentos: sempre FR (`pos_issue_fr`), com "Consumidor final" quando
     não há NUIT. Anulação só no próprio dia (`pos_void_fr`); depois, NC
     (`pos_issue_nc`) parcial ou total.
  5. Pagamentos (`pos_payments`): numerário, M-Pesa, e-Mola, cartão,
     transferência, misto. M-Pesa/e-Mola exigem um pedido confirmado
     (`pos_payment_requests`) antes da emissão. Por agora o fornecedor é o
     simulador: confirma ao fim de ~4 s; números terminados em 0000 falham.
     A estrutura está pronta para a Sislog (provider = 'sislog').
*/

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_operator_sessions (
  token_hash text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.pos_staff(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.pos_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE RESTRICT,
  number integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by uuid NOT NULL REFERENCES public.pos_staff(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(12,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_by uuid REFERENCES public.pos_staff(id),
  closed_at timestamptz,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2),
  counted_denominations jsonb,
  approved_by uuid REFERENCES public.pos_staff(id),
  notes text,
  summary jsonb,
  UNIQUE (company_id, number)
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_sessions_one_open_per_terminal
  ON public.pos_sessions (terminal_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pos_sessions_company ON public.pos_sessions (company_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.pos_sessions(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('in', 'out')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  notes text,
  staff_id uuid NOT NULL REFERENCES public.pos_staff(id),
  authorized_by uuid REFERENCES public.pos_staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_session ON public.pos_cash_movements (session_id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pos_session_id uuid REFERENCES public.pos_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_staff_id uuid REFERENCES public.pos_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_client_uuid uuid,
  ADD COLUMN IF NOT EXISTS table_label text,
  ADD COLUMN IF NOT EXISTS covers integer;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_pos_client_uuid_key
  ON public.invoices (company_id, pos_client_uuid) WHERE pos_client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_pos_session ON public.invoices (pos_session_id) WHERE pos_session_id IS NOT NULL;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS source_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.pos_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.pos_sessions(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.pos_staff(id),
  method text NOT NULL CHECK (method IN ('mpesa', 'emola')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  phone text NOT NULL,
  provider text NOT NULL DEFAULT 'simulator' CHECK (provider IN ('simulator', 'sislog')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed', 'expired', 'cancelled')),
  reference text,
  provider_payload jsonb,
  failure_reason text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_requests_session ON public.pos_payment_requests (session_id, status);

CREATE TABLE IF NOT EXISTS public.pos_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.pos_sessions(id) ON DELETE SET NULL,
  -- Positivo = recebido; negativo = devolvido (NC ou anulação).
  method text NOT NULL CHECK (method IN ('cash', 'mpesa', 'emola', 'card', 'transfer')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  tendered numeric(12,2),
  change_given numeric(12,2) NOT NULL DEFAULT 0,
  reference text,
  phone text,
  request_id uuid REFERENCES public.pos_payment_requests(id),
  simulated boolean NOT NULL DEFAULT false,
  staff_id uuid REFERENCES public.pos_staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_payments_session ON public.pos_payments (session_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_invoice ON public.pos_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_company_date ON public.pos_payments (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pos_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.pos_sessions(id) ON DELETE SET NULL,
  action text NOT NULL,
  requested_by uuid REFERENCES public.pos_staff(id),
  authorized_by uuid NOT NULL REFERENCES public.pos_staff(id),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_authorizations_company ON public.pos_authorizations (company_id, created_at DESC);

-- Leitura na aplicação da empresa (relatórios). As escritas são só pelas funções.
ALTER TABLE public.pos_operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_authorizations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_sessions', 'pos_cash_movements', 'pos_payment_requests', 'pos_payments', 'pos_authorizations']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Managers view %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Managers view %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.pos_is_manager(company_id))', t);
  END LOOP;
END $$;

-- Os vendedores (papel user) vêem os pagamentos das FR na lista de facturas.
DROP POLICY IF EXISTS "Members view pos payments" ON public.pos_payments;
CREATE POLICY "Members view pos payments" ON public.pos_payments
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 2. Contexto do operador e permissões
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pos_round(p numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT round(COALESCE(p, 0), 2); $$;

/*
  Valida o terminal da sessão, o token do operador e o acesso da empresa ao
  POS (plano + tolerância). Devolve o terminal, a empresa e o funcionário.
*/
CREATE OR REPLACE FUNCTION public._pos_ctx(p_token text)
RETURNS TABLE (
  terminal_id uuid,
  terminal_name text,
  company_id uuid,
  staff_id uuid,
  staff_name text,
  staff_role text,
  staff_permissions jsonb,
  staff_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
  v_access jsonb;
BEGIN
  v_terminal := public.pos_current_terminal();
  IF v_terminal.id IS NULL THEN
    RAISE EXCEPTION 'Este dispositivo não está emparelhado ou foi revogado.'
      USING ERRCODE = '42501', DETAIL = 'POS_TERMINAL_REVOKED';
  END IF;

  v_access := public.company_pos_access(v_terminal.company_id);
  IF NOT COALESCE((v_access ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'O Ponto de Venda não está disponível: verifique o plano e a subscrição da empresa.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT v_terminal.id, v_terminal.name, v_terminal.company_id,
         s.id, s.name, s.role, s.permissions, s.user_id
    FROM pos_operator_sessions os
    JOIN pos_staff s ON s.id = os.staff_id
   WHERE os.token_hash = encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex')
     AND os.terminal_id = v_terminal.id
     AND os.revoked_at IS NULL
     AND os.expires_at > now()
     AND s.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sessão do operador terminou. Introduza o PIN novamente.'
      USING ERRCODE = '42501', DETAIL = 'POS_OPERATOR_EXPIRED';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_ctx(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pos_role_allows(p_role text, p_permissions jsonb, p_action text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role = 'manager' THEN true
    WHEN p_permissions ? p_action THEN COALESCE((p_permissions ->> p_action)::boolean, false)
    WHEN p_role = 'cashier' THEN p_action IN ('sell', 'open_session', 'close_session', 'report_x', 'orders')
    WHEN p_role = 'waiter' THEN p_action IN ('orders')
    ELSE false
  END;
$$;

/*
  Exige uma permissão. Se o operador não a tem, aceita o PIN de um gerente
  activo da empresa e regista a autorização. Devolve o id de quem autorizou
  (o próprio operador quando tem permissão).
*/
CREATE OR REPLACE FUNCTION public._pos_require(
  p_company_id uuid,
  p_terminal_id uuid,
  p_staff_id uuid,
  p_role text,
  p_permissions jsonb,
  p_action text,
  p_auth_pin text,
  p_details jsonb DEFAULT NULL,
  p_invoice_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_manager uuid;
  v_session uuid;
BEGIN
  IF public._pos_role_allows(p_role, p_permissions, p_action) THEN
    RETURN p_staff_id;
  END IF;

  IF p_auth_pin IS NULL OR btrim(p_auth_pin) = '' THEN
    RAISE EXCEPTION 'Esta operação precisa da autorização de um gerente.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_AUTH_REQUIRED', HINT = p_action;
  END IF;

  SELECT s.id INTO v_manager
    FROM pos_staff s
   WHERE s.company_id = p_company_id
     AND s.is_active
     AND s.pin_hash IS NOT NULL
     AND (s.locked_until IS NULL OR s.locked_until < now())
     AND public._pos_role_allows(s.role, s.permissions, p_action)
     AND s.pin_hash = crypt(p_auth_pin, s.pin_hash)
   LIMIT 1;

  IF v_manager IS NULL THEN
    RAISE EXCEPTION 'PIN de autorização inválido.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_AUTH_INVALID', HINT = p_action;
  END IF;

  SELECT id INTO v_session FROM pos_sessions WHERE terminal_id = p_terminal_id AND status = 'open';

  INSERT INTO pos_authorizations (company_id, terminal_id, session_id, action, requested_by, authorized_by, invoice_id, details)
  VALUES (p_company_id, p_terminal_id, v_session, p_action, p_staff_id, v_manager, p_invoice_id, p_details);

  RETURN v_manager;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_require(uuid, uuid, uuid, text, jsonb, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pos_audit(
  p_company_id uuid,
  p_action text,
  p_entity_id uuid,
  p_entity_name text,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_logs (company_id, action, category, entity_id, entity_name, details)
  VALUES (p_company_id, p_action, 'pos', p_entity_id, p_entity_name, p_details);
EXCEPTION WHEN OTHERS THEN
  -- A auditoria nunca impede uma venda.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_audit(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Pedidos de mesa abertos (redefinida pela fase de restaurante).
CREATE OR REPLACE FUNCTION public._pos_open_orders_count(p_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$ SELECT 0; $$;

-- ---------------------------------------------------------------------------
-- 3. Terminal e operadores
-- ---------------------------------------------------------------------------
-- Ecrã de entrada: terminal, empresa, estado do plano e lista de operadores.
CREATE OR REPLACE FUNCTION public.pos_terminal_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
BEGIN
  v_terminal := public.pos_current_terminal();
  IF v_terminal.id IS NULL THEN
    RAISE EXCEPTION 'Este dispositivo não está emparelhado ou foi revogado.'
      USING ERRCODE = '42501', DETAIL = 'POS_TERMINAL_REVOKED';
  END IF;

  UPDATE pos_terminals SET last_seen_at = now() WHERE id = v_terminal.id;

  RETURN jsonb_build_object(
    'terminal', jsonb_build_object('id', v_terminal.id, 'name', v_terminal.name),
    'company', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name, 'nuit', c.nuit, 'logo_url', c.logo_url,
                                'business_type', c.pos_business_type)
        FROM companies c WHERE c.id = v_terminal.company_id
    ),
    'access', public.company_pos_access(v_terminal.company_id),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'role', s.role, 'color', s.color,
               'has_pin', s.pin_hash IS NOT NULL,
               'locked', s.locked_until IS NOT NULL AND s.locked_until > now())
             ORDER BY s.role = 'manager', s.name)
        FROM pos_staff s
       WHERE s.company_id = v_terminal.company_id AND s.is_active
    ), '[]'::jsonb),
    'open_session', (
      SELECT jsonb_build_object('id', ps.id, 'number', ps.number, 'opened_at', ps.opened_at,
                                'opened_by', (SELECT name FROM pos_staff WHERE id = ps.opened_by))
        FROM pos_sessions ps WHERE ps.terminal_id = v_terminal.id AND ps.status = 'open'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_terminal_info() TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_operator_login(p_staff_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
  v_staff pos_staff%ROWTYPE;
  v_token text;
  v_expires timestamptz := now() + interval '12 hours';
BEGIN
  v_terminal := public.pos_current_terminal();
  IF v_terminal.id IS NULL THEN
    RAISE EXCEPTION 'Este dispositivo não está emparelhado ou foi revogado.'
      USING ERRCODE = '42501', DETAIL = 'POS_TERMINAL_REVOKED';
  END IF;

  SELECT * INTO v_staff FROM pos_staff
   WHERE id = p_staff_id AND company_id = v_terminal.company_id AND is_active
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Este funcionário ainda não tem PIN. Peça ao gerente para o definir.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_NO_PIN';
  END IF;
  IF v_staff.locked_until IS NOT NULL AND v_staff.locked_until > now() THEN
    RAISE EXCEPTION 'Funcionário bloqueado por tentativas falhadas. Tente após %.',
      to_char(v_staff.locked_until AT TIME ZONE 'Africa/Maputo', 'HH24:MI')
      USING ERRCODE = 'P0001', DETAIL = 'POS_STAFF_LOCKED';
  END IF;

  IF v_staff.pin_hash <> crypt(COALESCE(p_pin, ''), v_staff.pin_hash) THEN
    UPDATE pos_staff
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '5 minutes' ELSE NULL END
     WHERE id = v_staff.id;
    PERFORM public._pos_audit(v_terminal.company_id, 'POS: PIN errado', v_staff.id, v_staff.name,
      jsonb_build_object('terminal', v_terminal.name, 'attempt', v_staff.failed_attempts + 1));
    -- RETURN em vez de RAISE: o contador de tentativas tem de ficar gravado.
    RETURN jsonb_build_object('ok', false,
      'error', CASE WHEN v_staff.failed_attempts + 1 >= 5
                    THEN 'PIN errado. Funcionário bloqueado durante 5 minutos.'
                    ELSE 'PIN errado.' END,
      'attempts_left', GREATEST(0, 4 - v_staff.failed_attempts));
  END IF;

  UPDATE pos_staff SET failed_attempts = 0, locked_until = NULL WHERE id = v_staff.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO pos_operator_sessions (token_hash, company_id, terminal_id, staff_id, expires_at)
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_terminal.company_id, v_terminal.id, v_staff.id, v_expires);

  DELETE FROM pos_operator_sessions WHERE expires_at < now() - interval '7 days';
  UPDATE pos_terminals SET last_seen_at = now() WHERE id = v_terminal.id;

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires,
    'staff', jsonb_build_object('id', v_staff.id, 'name', v_staff.name, 'role', v_staff.role,
                                'color', v_staff.color, 'permissions', v_staff.permissions)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_operator_login(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_operator_logout(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE pos_operator_sessions
     SET revoked_at = now()
   WHERE token_hash = encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex')
     AND terminal_id = (public.pos_current_terminal()).id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_operator_logout(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Dados do terminal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_bootstrap(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
               'id', co.id, 'name', co.name, 'nuit', co.nuit, 'address', co.address,
               'province', co.province, 'phone', co.phone, 'email', co.email, 'logo_url', co.logo_url,
               'business_type', co.pos_business_type, 'settings', co.pos_settings,
               'mpesa_number', co.mpesa_number, 'emola_number', co.emola_number)
        FROM companies co WHERE co.id = c.company_id
    ),
    'access', public.company_pos_access(c.company_id),
    'terminal', jsonb_build_object('id', c.terminal_id, 'name', c.terminal_name),
    'staff', jsonb_build_object('id', c.staff_id, 'name', c.staff_name, 'role', c.staff_role,
                                'permissions', c.staff_permissions),
    'walk_in_client_id', public._ensure_walk_in_client(c.company_id),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pc.id, 'name', pc.name, 'color', pc.color, 'icon', pc.icon)
             ORDER BY pc.sort_order, pc.name)
        FROM product_categories pc
       WHERE pc.company_id = c.company_id AND pc.is_active
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'barcode', p.barcode, 'name', p.name, 'price', p.price,
               'type', p.type, 'unit', p.unit, 'stock', p.stock, 'category_id', p.category_id,
               'station', p.pos_station, 'image_url', p.image_url, 'sold_by_weight', p.sold_by_weight,
               'available', p.pos_available)
             ORDER BY p.name)
        FROM products p
       WHERE p.company_id = c.company_id AND COALESCE(p.is_active, true) AND p.pos_visible
    ), '[]'::jsonb),
    'zones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'icon', z.icon) ORDER BY z.sort_order, z.name)
        FROM pos_zones z WHERE z.company_id = c.company_id AND z.is_active
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'zone_id', t.zone_id, 'seats', t.seats)
             ORDER BY t.sort_order, t.name)
        FROM pos_tables t WHERE t.company_id = c.company_id AND t.is_active
    ), '[]'::jsonb),
    'session', (
      SELECT jsonb_build_object('id', s.id, 'number', s.number, 'opened_at', s.opened_at,
                                'opening_float', s.opening_float,
                                'opened_by', (SELECT name FROM pos_staff WHERE id = s.opened_by))
        FROM pos_sessions s WHERE s.terminal_id = c.terminal_id AND s.status = 'open'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_bootstrap(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_search_clients(p_token text, p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_q text := btrim(COALESCE(p_query, ''));
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  IF char_length(v_q) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'nuit', x.nuit, 'phone', x.phone))
      FROM (
        SELECT cl.id, cl.name, cl.nuit, cl.phone
          FROM clients cl
         WHERE cl.company_id = c.company_id
           AND NOT cl.is_walk_in
           AND COALESCE(cl.is_active, true)
           AND (cl.name ILIKE '%' || v_q || '%' OR cl.nuit LIKE v_q || '%' OR cl.phone LIKE '%' || v_q || '%')
         ORDER BY cl.name
         LIMIT 20
      ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_search_clients(text, text) TO authenticated;

-- Cria o cliente (ou devolve o existente com o mesmo NUIT).
CREATE OR REPLACE FUNCTION public.pos_create_client(p_token text, p_name text, p_nuit text, p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_nuit text := regexp_replace(COALESCE(p_nuit, ''), '\D', '', 'g');
  v_name text := btrim(COALESCE(p_name, ''));
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  IF v_nuit !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'O NUIT deve ter 9 dígitos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_client FROM clients
   WHERE company_id = c.company_id AND NOT is_walk_in AND regexp_replace(COALESCE(nuit, ''), '\D', '', 'g') = v_nuit
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_client.id, 'name', v_client.name, 'nuit', v_client.nuit, 'existing', true);
  END IF;

  IF char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'Indique o nome do cliente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO clients (company_id, name, nuit, phone, is_active)
  VALUES (c.company_id, v_name, v_nuit, NULLIF(btrim(COALESCE(p_phone, '')), ''), true)
  RETURNING * INTO v_client;

  RETURN jsonb_build_object('id', v_client.id, 'name', v_client.name, 'nuit', v_client.nuit, 'existing', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_create_client(text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Caixa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pos_session_summary(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s pos_sessions%ROWTYPE;
  v_cash numeric;
  v_in numeric;
  v_out numeric;
BEGIN
  SELECT * INTO s FROM pos_sessions WHERE id = p_session_id;

  SELECT COALESCE(sum(amount), 0) INTO v_cash FROM pos_payments WHERE session_id = s.id AND method = 'cash';
  SELECT COALESCE(sum(amount) FILTER (WHERE type = 'in'), 0), COALESCE(sum(amount) FILTER (WHERE type = 'out'), 0)
    INTO v_in, v_out FROM pos_cash_movements WHERE session_id = s.id;

  RETURN jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'number', s.number, 'status', s.status,
                                  'opened_at', s.opened_at, 'closed_at', s.closed_at,
                                  'opened_by', (SELECT name FROM pos_staff WHERE id = s.opened_by),
                                  'closed_by', (SELECT name FROM pos_staff WHERE id = s.closed_by),
                                  'terminal', (SELECT name FROM pos_terminals WHERE id = s.terminal_id),
                                  'opening_float', s.opening_float),
    'documents', COALESCE((
      SELECT jsonb_object_agg(k.document_type, jsonb_build_object('count', k.n, 'total', k.total))
        FROM (
          SELECT document_type, count(*) AS n, sum(total) AS total
            FROM invoices
           WHERE pos_session_id = s.id AND status <> 'anulada'
           GROUP BY document_type
        ) k
    ), '{}'::jsonb),
    'voided', (
      SELECT jsonb_build_object('count', count(*), 'total', COALESCE(sum(total), 0))
        FROM invoices WHERE pos_session_id = s.id AND status = 'anulada'
    ),
    'discounts', (
      SELECT COALESCE(sum(discount_total), 0)
        FROM invoices WHERE pos_session_id = s.id AND status <> 'anulada' AND document_type = 'FR'
    ),
    'net_sales', (
      SELECT COALESCE(sum(total), 0) FROM invoices WHERE pos_session_id = s.id AND status <> 'anulada'
    ),
    'payments', COALESCE((
      SELECT jsonb_object_agg(m.method, jsonb_build_object('count', m.n, 'total', m.total))
        FROM (
          SELECT method, count(*) FILTER (WHERE amount > 0) AS n, sum(amount) AS total
            FROM pos_payments WHERE session_id = s.id GROUP BY method
        ) m
    ), '{}'::jsonb),
    'simulated_payments', (
      SELECT COALESCE(sum(amount), 0) FROM pos_payments WHERE session_id = s.id AND simulated
    ),
    'by_staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', st.name, 'count', x.n, 'total', x.total) ORDER BY x.total DESC)
        FROM (
          SELECT pos_staff_id, count(*) FILTER (WHERE document_type = 'FR') AS n, sum(total) AS total
            FROM invoices WHERE pos_session_id = s.id AND status <> 'anulada'
           GROUP BY pos_staff_id
        ) x
        LEFT JOIN pos_staff st ON st.id = x.pos_staff_id
    ), '[]'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type', m.type, 'amount', m.amount, 'reason', m.reason,
                                          'notes', m.notes, 'created_at', m.created_at,
                                          'staff', (SELECT name FROM pos_staff WHERE id = m.staff_id))
             ORDER BY m.created_at)
        FROM pos_cash_movements m WHERE m.session_id = s.id
    ), '[]'::jsonb),
    'cash', jsonb_build_object(
      'opening_float', s.opening_float,
      'sales', v_cash,
      'in', v_in,
      'out', v_out,
      'expected', public._pos_round(s.opening_float + v_cash + v_in - v_out)
    ),
    'authorizations', (SELECT count(*) FROM pos_authorizations WHERE session_id = s.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._pos_session_summary(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_open_session(p_token text, p_opening_float numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_number integer;
  v_session pos_sessions%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                              'open_session', NULL);

  IF COALESCE(p_opening_float, 0) < 0 THEN
    RAISE EXCEPTION 'O fundo de caixa não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  -- Serializa a abertura por empresa (numeração).
  PERFORM 1 FROM companies WHERE id = c.company_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM pos_sessions WHERE terminal_id = c.terminal_id AND status = 'open') THEN
    RAISE EXCEPTION 'Já existe uma caixa aberta neste terminal.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(number), 0) + 1 INTO v_number FROM pos_sessions WHERE company_id = c.company_id;

  INSERT INTO pos_sessions (company_id, terminal_id, number, opened_by, opening_float)
  VALUES (c.company_id, c.terminal_id, v_number, c.staff_id, public._pos_round(p_opening_float))
  RETURNING * INTO v_session;

  PERFORM public._pos_audit(c.company_id, 'POS: Abriu caixa', v_session.id, 'Caixa ' || v_number,
    jsonb_build_object('terminal', c.terminal_name, 'staff', c.staff_name, 'opening_float', v_session.opening_float));

  RETURN jsonb_build_object('id', v_session.id, 'number', v_session.number, 'opened_at', v_session.opened_at,
                            'opening_float', v_session.opening_float, 'opened_by', c.staff_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_open_session(text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public._pos_open_session_id(p_terminal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM pos_sessions WHERE terminal_id = p_terminal_id AND status = 'open';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Abra a caixa antes de continuar.' USING ERRCODE = 'P0001', DETAIL = 'POS_NO_SESSION';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_open_session_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_cash_movement(
  p_token text,
  p_type text,
  p_amount numeric,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_auth_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_session uuid;
  v_auth uuid;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  v_session := public._pos_open_session_id(c.terminal_id);

  IF p_type NOT IN ('in', 'out') OR COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Movimento inválido.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 2 THEN
    RAISE EXCEPTION 'Indique o motivo.' USING ERRCODE = '22023';
  END IF;

  v_auth := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                'cash_movement', p_auth_pin,
                                jsonb_build_object('type', p_type, 'amount', p_amount, 'reason', p_reason));

  INSERT INTO pos_cash_movements (company_id, session_id, type, amount, reason, notes, staff_id, authorized_by)
  VALUES (c.company_id, v_session, p_type, public._pos_round(p_amount), btrim(p_reason),
          NULLIF(btrim(COALESCE(p_notes, '')), ''), c.staff_id, NULLIF(v_auth, c.staff_id))
  RETURNING id INTO v_id;

  PERFORM public._pos_audit(c.company_id,
    CASE p_type WHEN 'in' THEN 'POS: Entrada de caixa' ELSE 'POS: Saída de caixa' END,
    v_id, btrim(p_reason), jsonb_build_object('amount', p_amount, 'staff', c.staff_name));

  RETURN public._pos_session_summary(v_session);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_cash_movement(text, text, numeric, text, text, text) TO authenticated;

-- Relatório X (parcial) da caixa aberta.
CREATE OR REPLACE FUNCTION public.pos_session_report(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  RETURN public._pos_session_summary(public._pos_open_session_id(c.terminal_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_session_report(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_close_session(
  p_token text,
  p_counted_cash numeric,
  p_denominations jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_auth_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_session uuid;
  v_summary jsonb;
  v_expected numeric;
  v_difference numeric;
  v_tolerance numeric;
  v_approved uuid;
  v_settings jsonb;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  v_session := public._pos_open_session_id(c.terminal_id);
  PERFORM 1 FROM pos_sessions WHERE id = v_session FOR UPDATE;

  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                              'close_session', NULL);

  IF COALESCE(p_counted_cash, -1) < 0 THEN
    RAISE EXCEPTION 'Indique o numerário contado.' USING ERRCODE = '22023';
  END IF;

  IF public._pos_open_orders_count(c.company_id) > 0 THEN
    RAISE EXCEPTION 'Há mesas ou pedidos abertos. Feche-os antes de fechar a caixa.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_OPEN_ORDERS';
  END IF;

  IF EXISTS (SELECT 1 FROM pos_payment_requests WHERE session_id = v_session AND status = 'pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Há pagamentos móveis pendentes. Conclua-os ou cancele-os antes de fechar.'
      USING ERRCODE = 'P0001', DETAIL = 'POS_PENDING_PAYMENTS';
  END IF;

  v_summary := public._pos_session_summary(v_session);
  v_expected := (v_summary #>> '{cash,expected}')::numeric;
  v_difference := public._pos_round(p_counted_cash - v_expected);

  SELECT pos_settings INTO v_settings FROM companies WHERE id = c.company_id;
  v_tolerance := COALESCE((v_settings #>> '{cash,tolerance}')::numeric, 0);

  IF abs(v_difference) > v_tolerance THEN
    IF char_length(btrim(COALESCE(p_notes, ''))) < 3 THEN
      RAISE EXCEPTION 'A diferença de caixa (% MZN) precisa de uma justificação.', v_difference
        USING ERRCODE = 'P0001', DETAIL = 'POS_DIFFERENCE_NOTES';
    END IF;
    v_approved := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                      'approve_difference', p_auth_pin,
                                      jsonb_build_object('difference', v_difference, 'expected', v_expected));
  END IF;

  -- Os pedidos expirados deixam de contar como pendentes.
  UPDATE pos_payment_requests SET status = 'expired'
   WHERE session_id = v_session AND status = 'pending';

  UPDATE pos_sessions
     SET status = 'closed',
         closed_by = c.staff_id,
         closed_at = now(),
         expected_cash = v_expected,
         counted_cash = public._pos_round(p_counted_cash),
         difference = v_difference,
         counted_denominations = p_denominations,
         approved_by = v_approved,
         notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
   WHERE id = v_session;

  v_summary := public._pos_session_summary(v_session);
  v_summary := v_summary || jsonb_build_object('close', jsonb_build_object(
    'counted', public._pos_round(p_counted_cash), 'expected', v_expected, 'difference', v_difference,
    'denominations', p_denominations, 'notes', p_notes,
    'approved_by', (SELECT name FROM pos_staff WHERE id = v_approved)));

  UPDATE pos_sessions SET summary = v_summary WHERE id = v_session;

  -- Ao fechar a caixa termina a sessão de todos os operadores do terminal.
  UPDATE pos_operator_sessions SET revoked_at = now()
   WHERE terminal_id = c.terminal_id AND revoked_at IS NULL;

  PERFORM public._pos_audit(c.company_id, 'POS: Fechou caixa', v_session,
    'Caixa ' || (v_summary #>> '{session,number}'),
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_difference,
                       'staff', c.staff_name));

  RETURN v_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_close_session(text, numeric, jsonb, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pagamentos móveis (simulador; futuro: Sislog)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_request_mobile_payment(
  p_token text,
  p_method text,
  p_amount numeric,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c record;
  v_session uuid;
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_settings jsonb;
  v_timeout integer;
  v_req pos_payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  v_session := public._pos_open_session_id(c.terminal_id);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'sell', NULL);

  IF p_method NOT IN ('mpesa', 'emola') THEN
    RAISE EXCEPTION 'Método inválido.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_phone ~ '^258' AND char_length(v_phone) = 12 THEN
    v_phone := substr(v_phone, 4);
  END IF;
  IF v_phone !~ '^8[2-7][0-9]{7}$' THEN
    RAISE EXCEPTION 'Número de telemóvel inválido (ex.: 84 123 4567).' USING ERRCODE = '22023';
  END IF;

  SELECT pos_settings INTO v_settings FROM companies WHERE id = c.company_id;
  v_timeout := LEAST(GREATEST(COALESCE((v_settings ->> 'mobile_timeout')::integer, 90), 30), 600);

  INSERT INTO pos_payment_requests (company_id, terminal_id, session_id, staff_id, method, amount, phone,
                                    provider, reference, expires_at)
  VALUES (c.company_id, c.terminal_id, v_session, c.staff_id, p_method, public._pos_round(p_amount), v_phone,
          'simulator', 'SIM-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
          now() + make_interval(secs => v_timeout))
  RETURNING * INTO v_req;

  RETURN to_jsonb(v_req) - 'provider_payload';
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_request_mobile_payment(text, text, numeric, text) TO authenticated;

/*
  Estado de um pedido. No simulador:
    - p_simulate 'confirm' ou 'fail' decide de imediato;
    - sem p_simulate, confirma 4 s depois do pedido, excepto números
      terminados em 0000 (falham com "saldo insuficiente");
    - passado o prazo, expira.
*/
CREATE OR REPLACE FUNCTION public.pos_check_mobile_payment(
  p_token text,
  p_request_id uuid,
  p_simulate text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_req pos_payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  SELECT * INTO v_req FROM pos_payment_requests
   WHERE id = p_request_id AND terminal_id = c.terminal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de pagamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'pending' THEN
    IF p_simulate = 'cancel' THEN
      UPDATE pos_payment_requests SET status = 'cancelled' WHERE id = v_req.id RETURNING * INTO v_req;
    ELSIF v_req.expires_at <= now() THEN
      UPDATE pos_payment_requests SET status = 'expired', failure_reason = 'O cliente não confirmou a tempo.'
       WHERE id = v_req.id RETURNING * INTO v_req;
    ELSIF v_req.provider = 'simulator' THEN
      IF p_simulate = 'fail' OR (p_simulate IS NULL AND v_req.phone LIKE '%0000' AND now() > v_req.created_at + interval '4 seconds') THEN
        UPDATE pos_payment_requests SET status = 'failed', failure_reason = 'Saldo insuficiente (simulação).'
         WHERE id = v_req.id RETURNING * INTO v_req;
      ELSIF p_simulate = 'confirm' OR (p_simulate IS NULL AND now() > v_req.created_at + interval '4 seconds') THEN
        UPDATE pos_payment_requests
           SET status = 'confirmed', confirmed_at = now(),
               provider_payload = jsonb_build_object('simulated', true,
                 'transaction_id', upper(v_req.method) || to_char(now(), 'YYMMDDHH24MISS'))
         WHERE id = v_req.id RETURNING * INTO v_req;
      END IF;
    END IF;
  END IF;

  RETURN to_jsonb(v_req) - 'provider_payload'
         || jsonb_build_object('transaction_id', v_req.provider_payload ->> 'transaction_id');
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_check_mobile_payment(text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Emitir FR
-- ---------------------------------------------------------------------------
/*
  p_payload:
  {
    "client_uuid": "…",                 idempotência (o mesmo pedido não emite duas vezes)
    "client_id": "…" | null,            null = Consumidor final
    "lines": [{"product_id": "…", "quantity": 2, "notes": "…"}],
    "discount": {"type": "pct" | "amount", "value": 10} | null,
    "payments": [{"method": "cash", "amount": 500, "tendered": 1000},
                 {"method": "mpesa", "request_id": "…"},
                 {"method": "card", "amount": 300, "reference": "TPA 1234"}],
    "table_label": "Mesa 4", "covers": 3, "notes": "…"
  }
  O valor do numerário é o que falta depois dos restantes métodos.
*/
CREATE OR REPLACE FUNCTION public._pos_issue_fr(c record, p_payload jsonb, p_auth_pin text, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session uuid;
  v_client_uuid uuid := NULLIF(p_payload ->> 'client_uuid', '')::uuid;
  v_existing uuid;
  v_client_id uuid := NULLIF(p_payload ->> 'client_id', '')::uuid;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_product products%ROWTYPE;
  v_qty numeric;
  v_price numeric;
  v_gross numeric := 0;
  v_discount numeric := 0;
  v_discount_type text := p_payload #>> '{discount,type}';
  v_discount_value numeric := COALESCE((p_payload #>> '{discount,value}')::numeric, 0);
  v_discount_pct numeric;
  v_max_pct numeric;
  v_total numeric;
  v_allocated numeric := 0;
  v_line_discount numeric;
  v_line_total numeric;
  v_count integer;
  v_i integer := 0;
  v_pay jsonb;
  v_req pos_payment_requests%ROWTYPE;
  v_noncash numeric := 0;
  v_cash_tendered numeric := 0;
  v_has_cash boolean := false;
  v_cash_amount numeric;
  v_payments jsonb := '[]'::jsonb;
  v_invoice_id uuid;
  v_auth uuid;
  v_simulated boolean;
BEGIN
  v_session := public._pos_open_session_id(c.terminal_id);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'sell', NULL);

  IF v_client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing FROM invoices WHERE company_id = c.company_id AND pos_client_uuid = v_client_uuid;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A venda não tem produtos.' USING ERRCODE = '22023';
  END IF;

  -- Linhas: preço e nome sempre da base de dados.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM products
     WHERE id = (v_line ->> 'product_id')::uuid AND company_id = c.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    v_qty := round((v_line ->> 'quantity')::numeric, 3);
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida em %.', v_product.name USING ERRCODE = '22023';
    END IF;
    IF NOT v_product.sold_by_weight AND v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION '% vende-se à unidade.', v_product.name USING ERRCODE = '22023';
    END IF;
    v_price := COALESCE((v_line ->> 'unit_price')::numeric, v_product.price);
    v_gross := v_gross + public._pos_round(v_qty * v_price);
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id, 'name', v_product.name, 'quantity', v_qty, 'unit_price', v_price,
      'gross', public._pos_round(v_qty * v_price), 'notes', v_line ->> 'notes',
      'order_line_id', v_line ->> 'order_line_id');
  END LOOP;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'O total da venda tem de ser positivo.' USING ERRCODE = '22023';
  END IF;

  -- Desconto global, distribuído pelas linhas.
  IF v_discount_value > 0 THEN
    IF v_discount_type = 'pct' THEN
      IF v_discount_value > 100 THEN
        RAISE EXCEPTION 'Desconto inválido.' USING ERRCODE = '22023';
      END IF;
      v_discount := public._pos_round(v_gross * v_discount_value / 100);
    ELSIF v_discount_type = 'amount' THEN
      v_discount := public._pos_round(LEAST(v_discount_value, v_gross));
    ELSE
      RAISE EXCEPTION 'Tipo de desconto inválido.' USING ERRCODE = '22023';
    END IF;

    v_discount_pct := v_discount * 100 / v_gross;
    v_max_pct := CASE WHEN c.staff_role = 'manager' THEN 100
                      ELSE COALESCE((c.staff_permissions ->> 'max_discount_pct')::numeric, 0) END;
    IF v_discount_pct > v_max_pct THEN
      v_auth := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                    'discount', p_auth_pin,
                                    jsonb_build_object('discount', v_discount, 'pct', round(v_discount_pct, 2), 'gross', v_gross));
    END IF;
  END IF;

  v_total := v_gross - v_discount;

  -- Pagamentos.
  IF jsonb_typeof(p_payload -> 'payments') <> 'array' OR jsonb_array_length(p_payload -> 'payments') = 0 THEN
    RAISE EXCEPTION 'Indique o pagamento.' USING ERRCODE = '22023';
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payload -> 'payments') LOOP
    CASE v_pay ->> 'method'
      WHEN 'cash' THEN
        IF v_has_cash THEN
          RAISE EXCEPTION 'Indique o numerário uma única vez.' USING ERRCODE = '22023';
        END IF;
        v_has_cash := true;
        v_cash_tendered := COALESCE((v_pay ->> 'tendered')::numeric, (v_pay ->> 'amount')::numeric, 0);
      WHEN 'mpesa', 'emola' THEN
        SELECT * INTO v_req FROM pos_payment_requests
         WHERE id = (v_pay ->> 'request_id')::uuid AND company_id = c.company_id
         FOR UPDATE;
        IF NOT FOUND OR v_req.method <> v_pay ->> 'method' THEN
          RAISE EXCEPTION 'Pagamento móvel não encontrado.' USING ERRCODE = 'P0002';
        END IF;
        IF v_req.status <> 'confirmed' THEN
          RAISE EXCEPTION 'O pagamento % ainda não foi confirmado.', upper(v_req.method)
            USING ERRCODE = 'P0001', DETAIL = 'POS_PAYMENT_NOT_CONFIRMED';
        END IF;
        IF v_req.invoice_id IS NOT NULL THEN
          RAISE EXCEPTION 'Este pagamento já foi usado noutra venda.' USING ERRCODE = '22023';
        END IF;
        v_noncash := v_noncash + v_req.amount;
        v_payments := v_payments || jsonb_build_object('method', v_req.method, 'amount', v_req.amount,
          'reference', COALESCE(v_req.provider_payload ->> 'transaction_id', v_req.reference),
          'phone', v_req.phone, 'request_id', v_req.id, 'simulated', v_req.provider = 'simulator');
      WHEN 'card', 'transfer' THEN
        IF COALESCE((v_pay ->> 'amount')::numeric, 0) <= 0 THEN
          RAISE EXCEPTION 'Valor inválido no pagamento.' USING ERRCODE = '22023';
        END IF;
        v_noncash := v_noncash + public._pos_round((v_pay ->> 'amount')::numeric);
        v_payments := v_payments || jsonb_build_object('method', v_pay ->> 'method',
          'amount', public._pos_round((v_pay ->> 'amount')::numeric),
          'reference', NULLIF(btrim(COALESCE(v_pay ->> 'reference', '')), ''), 'simulated', false);
      ELSE
        RAISE EXCEPTION 'Método de pagamento inválido.' USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  IF v_noncash > v_total + 0.004 THEN
    RAISE EXCEPTION 'Os pagamentos (% MZN) excedem o total (% MZN). Só o numerário dá troco.', v_noncash, v_total
      USING ERRCODE = '22023';
  END IF;

  v_cash_amount := public._pos_round(v_total - v_noncash);
  IF v_cash_amount > 0 THEN
    IF NOT v_has_cash OR v_cash_tendered + 0.004 < v_cash_amount THEN
      RAISE EXCEPTION 'Faltam % MZN para completar o pagamento.', public._pos_round(v_cash_amount - CASE WHEN v_has_cash THEN v_cash_tendered ELSE 0 END)
        USING ERRCODE = 'P0001', DETAIL = 'POS_PAYMENT_SHORT';
    END IF;
    v_payments := v_payments || jsonb_build_object('method', 'cash', 'amount', v_cash_amount,
      'tendered', public._pos_round(v_cash_tendered),
      'change', public._pos_round(v_cash_tendered - v_cash_amount), 'simulated', false);
  END IF;

  -- Cliente.
  IF v_client_id IS NULL THEN
    v_client_id := public._ensure_walk_in_client(c.company_id);
  ELSIF NOT EXISTS (SELECT 1 FROM clients WHERE id = v_client_id AND company_id = c.company_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO invoices (company_id, client_id, invoice_number, document_type, origin, date, subtotal, total,
                        amount_paid, amount_pending, status, notes, created_by, discount_total,
                        pos_session_id, pos_terminal_id, pos_staff_id, pos_client_uuid, table_label, covers)
  VALUES (c.company_id, v_client_id, '', 'FR', 'pos', (now() AT TIME ZONE 'Africa/Maputo')::date,
          v_total, v_total, v_total, 0, 'paga', NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), ''),
          (SELECT id FROM profiles WHERE id = c.staff_user_id), v_discount,
          v_session, c.terminal_id, c.staff_id, v_client_uuid,
          NULLIF(btrim(COALESCE(p_payload ->> 'table_label', '')), ''),
          NULLIF((p_payload ->> 'covers')::integer, 0))
  RETURNING id INTO v_invoice_id;

  v_count := jsonb_array_length(v_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_i := v_i + 1;
    IF v_discount = 0 THEN
      v_line_discount := 0;
    ELSIF v_i = v_count THEN
      v_line_discount := v_discount - v_allocated;
    ELSE
      v_line_discount := public._pos_round(v_discount * (v_line ->> 'gross')::numeric / v_gross);
    END IF;
    v_allocated := v_allocated + v_line_discount;
    v_line_total := (v_line ->> 'gross')::numeric - v_line_discount;

    INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal, total,
                               discount, notes)
    VALUES (v_invoice_id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', (v_line ->> 'quantity')::numeric,
            (v_line ->> 'unit_price')::numeric, v_line_total, v_line_total, v_line_discount,
            NULLIF(btrim(COALESCE(v_line ->> 'notes', '')), ''));
  END LOOP;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    v_simulated := COALESCE((v_pay ->> 'simulated')::boolean, false);
    INSERT INTO pos_payments (company_id, invoice_id, session_id, method, amount, tendered, change_given,
                              reference, phone, request_id, simulated, staff_id)
    VALUES (c.company_id, v_invoice_id, v_session, v_pay ->> 'method', (v_pay ->> 'amount')::numeric,
            (v_pay ->> 'tendered')::numeric, COALESCE((v_pay ->> 'change')::numeric, 0),
            v_pay ->> 'reference', v_pay ->> 'phone', (v_pay ->> 'request_id')::uuid, v_simulated, c.staff_id);
    IF v_pay ? 'request_id' THEN
      UPDATE pos_payment_requests SET invoice_id = v_invoice_id WHERE id = (v_pay ->> 'request_id')::uuid;
    END IF;
  END LOOP;

  -- No POS o stock pode ficar negativo (a venda já aconteceu).
  PERFORM public._apply_invoice_stock(v_invoice_id, false, true);

  IF v_auth IS NOT NULL THEN
    UPDATE pos_authorizations SET invoice_id = v_invoice_id
     WHERE id = (SELECT id FROM pos_authorizations WHERE authorized_by = v_auth AND session_id = v_session
                  ORDER BY created_at DESC LIMIT 1);
  END IF;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_issue_fr(record, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Documento completo (para imprimir e para o histórico).
CREATE OR REPLACE FUNCTION public._pos_document(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'document_type', i.document_type, 'status', i.status,
    'date', i.date, 'issued_at', COALESCE(i.issued_at, i.created_at),
    'subtotal', i.subtotal, 'discount_total', i.discount_total, 'total', i.total,
    'client', jsonb_build_object('id', cl.id, 'name', cl.name, 'nuit', cl.nuit, 'walk_in', cl.is_walk_in),
    'staff', (SELECT name FROM pos_staff WHERE id = i.pos_staff_id),
    'terminal', (SELECT name FROM pos_terminals WHERE id = i.pos_terminal_id),
    'session_id', i.pos_session_id,
    'table_label', i.table_label, 'covers', i.covers, 'notes', i.notes,
    'related', (SELECT jsonb_build_object('id', r.id, 'number', r.invoice_number) FROM invoices r WHERE r.id = i.related_invoice_id),
    'credit_reason', i.credit_reason,
    'annulment_reason', i.annulment_reason, 'annulled_at', i.annulled_at,
    'print_count', COALESCE(i.print_count, 0),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', it.id, 'product_id', it.product_id, 'name', it.product_name, 'quantity', it.quantity,
               'unit_price', it.unit_price, 'discount', it.discount, 'total', it.total, 'notes', it.notes,
               'returned', COALESCE((
                 SELECT -sum(r.quantity) FROM invoice_items r
                   JOIN invoices rn ON rn.id = r.invoice_id AND rn.status <> 'anulada'
                  WHERE r.source_item_id = it.id), 0))
             ORDER BY it.created_at, it.id)
        FROM invoice_items it WHERE it.invoice_id = i.id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'tendered', p.tendered,
                                          'change', p.change_given, 'reference', p.reference, 'phone', p.phone,
                                          'simulated', p.simulated)
             ORDER BY p.created_at)
        FROM pos_payments p WHERE p.invoice_id = i.id
    ), '[]'::jsonb),
    'credit_notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'number', n.invoice_number, 'total', n.total))
        FROM invoices n WHERE n.related_invoice_id = i.id AND n.status <> 'anulada'
    ), '[]'::jsonb)
  )
  FROM invoices i
  JOIN clients cl ON cl.id = i.client_id
  WHERE i.id = p_invoice_id;
$$;

REVOKE ALL ON FUNCTION public._pos_document(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_issue_fr(p_token text, p_payload jsonb, p_auth_pin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_id uuid;
  v_doc jsonb;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  -- O preço vem sempre da base de dados: unit_price só é aceite nos pedidos de
  -- mesa (preço gravado no pedido, ver pos_checkout_order).
  v_id := public._pos_issue_fr(c, p_payload, p_auth_pin, COALESCE((
    SELECT jsonb_agg(l - 'unit_price' - 'order_line_id')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload -> 'lines') = 'array'
                                     THEN p_payload -> 'lines' ELSE '[]'::jsonb END) l
  ), '[]'::jsonb));
  v_doc := public._pos_document(v_id);
  PERFORM public._pos_audit(c.company_id, 'POS: Emitiu Factura-Recibo', v_id, v_doc ->> 'number',
    jsonb_build_object('total', v_doc -> 'total', 'staff', c.staff_name, 'terminal', c.terminal_name));
  RETURN v_doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_issue_fr(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_get_document(p_token text, p_invoice_id uuid, p_reprint boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id AND company_id = c.company_id AND origin = 'pos') THEN
    RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_reprint THEN
    UPDATE invoices SET print_count = COALESCE(print_count, 0) + 1 WHERE id = p_invoice_id;
  END IF;
  RETURN public._pos_document(p_invoice_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_get_document(text, uuid, boolean) TO authenticated;

-- Histórico: 'session' (caixa aberta), 'today', 'week' (7 dias).
CREATE OR REPLACE FUNCTION public.pos_list_documents(p_token text, p_scope text DEFAULT 'session', p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_session uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  SELECT id INTO v_session FROM pos_sessions WHERE terminal_id = c.terminal_id AND status = 'open';

  RETURN COALESCE((
    SELECT jsonb_agg(x.doc ORDER BY x.created_at DESC)
      FROM (
        SELECT i.created_at, jsonb_build_object(
                 'id', i.id, 'number', i.invoice_number, 'document_type', i.document_type, 'status', i.status,
                 'date', i.date, 'issued_at', COALESCE(i.issued_at, i.created_at), 'total', i.total,
                 'discount_total', i.discount_total,
                 'client', cl.name, 'client_nuit', cl.nuit, 'walk_in', cl.is_walk_in,
                 'staff', st.name, 'table_label', i.table_label,
                 'methods', (SELECT jsonb_agg(DISTINCT p.method) FROM pos_payments p WHERE p.invoice_id = i.id AND p.amount > 0),
                 'related', (SELECT r.invoice_number FROM invoices r WHERE r.id = i.related_invoice_id),
                 'has_credit_notes', EXISTS (SELECT 1 FROM invoices n WHERE n.related_invoice_id = i.id AND n.status <> 'anulada'),
                 'session_id', i.pos_session_id
               ) AS doc
          FROM invoices i
          JOIN clients cl ON cl.id = i.client_id
          LEFT JOIN pos_staff st ON st.id = i.pos_staff_id
         WHERE i.company_id = c.company_id
           AND i.origin = 'pos'
           AND CASE COALESCE(p_scope, 'session')
                 WHEN 'session' THEN i.pos_session_id = v_session
                 WHEN 'today' THEN i.date = v_today
                 ELSE i.date >= v_today - 7
               END
           AND (v_q IS NULL OR i.invoice_number ILIKE '%' || v_q || '%' OR cl.name ILIKE '%' || v_q || '%'
                OR cl.nuit LIKE v_q || '%')
         ORDER BY i.created_at DESC
         LIMIT 300
      ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_list_documents(text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Anular FR (no próprio dia) e notas de crédito
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_void_fr(p_token text, p_invoice_id uuid, p_reason text, p_auth_pin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_session uuid;
  v_inv invoices%ROWTYPE;
  v_auth uuid;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  v_session := public._pos_open_session_id(c.terminal_id);

  SELECT * INTO v_inv FROM invoices
   WHERE id = p_invoice_id AND company_id = c.company_id AND origin = 'pos'
   FOR UPDATE;
  IF NOT FOUND OR v_inv.document_type <> 'FR' THEN
    RAISE EXCEPTION 'Factura-recibo não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.status = 'anulada' THEN
    RAISE EXCEPTION 'Este documento já está anulado.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Indique o motivo da anulação.' USING ERRCODE = '22023';
  END IF;

  v_auth := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                'void_sale', p_auth_pin,
                                jsonb_build_object('number', v_inv.invoice_number, 'total', v_inv.total, 'reason', p_reason),
                                v_inv.id);

  -- O trigger valida: só no próprio dia e sem NC.
  UPDATE invoices
     SET status = 'anulada', annulment_reason = left(btrim(p_reason), 500),
         amount_paid = 0, amount_pending = 0
   WHERE id = v_inv.id;

  -- O dinheiro volta ao cliente pela caixa aberta, pelo mesmo método.
  INSERT INTO pos_payments (company_id, invoice_id, session_id, method, amount, reference, phone, simulated, staff_id)
  SELECT company_id, invoice_id, v_session, method, -amount, reference, phone, simulated, c.staff_id
    FROM pos_payments WHERE invoice_id = v_inv.id AND amount > 0;

  PERFORM public._apply_invoice_stock(v_inv.id, true, true);

  PERFORM public._pos_audit(c.company_id, 'POS: Anulou Factura-Recibo', v_inv.id, v_inv.invoice_number,
    jsonb_build_object('total', v_inv.total, 'reason', p_reason, 'staff', c.staff_name,
                       'authorized_by', (SELECT name FROM pos_staff WHERE id = v_auth)));

  RETURN public._pos_document(v_inv.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_void_fr(text, uuid, text, text) TO authenticated;

/*
  NC parcial ou total de uma FR. p_lines: [{"item_id": "…", "quantity": 1}].
  Valor de cada linha = preço × quantidade menos a parte proporcional do
  desconto da linha original. Devolução pelo método indicado (por omissão o
  da FR; numerário quando houve vários).
*/
CREATE OR REPLACE FUNCTION public.pos_issue_nc(
  p_token text,
  p_invoice_id uuid,
  p_lines jsonb,
  p_reason text,
  p_refund_method text DEFAULT NULL,
  p_auth_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_session uuid;
  v_inv invoices%ROWTYPE;
  v_auth uuid;
  v_line jsonb;
  v_item invoice_items%ROWTYPE;
  v_returned numeric;
  v_qty numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_nc uuid;
  v_method text := p_refund_method;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  v_session := public._pos_open_session_id(c.terminal_id);

  SELECT * INTO v_inv FROM invoices
   WHERE id = p_invoice_id AND company_id = c.company_id AND document_type = 'FR'
   FOR UPDATE;
  IF NOT FOUND OR v_inv.status = 'anulada' THEN
    RAISE EXCEPTION 'Factura-recibo não encontrada ou anulada.' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Indique o motivo da devolução.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Escolha os artigos a devolver.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_item FROM invoice_items WHERE id = (v_line ->> 'item_id')::uuid AND invoice_id = v_inv.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Artigo não pertence a esta factura.' USING ERRCODE = '22023';
    END IF;
    v_qty := round(COALESCE((v_line ->> 'quantity')::numeric, 0), 3);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(-sum(r.quantity), 0) INTO v_returned
      FROM invoice_items r JOIN invoices n ON n.id = r.invoice_id AND n.status <> 'anulada'
     WHERE r.source_item_id = v_item.id;
    IF v_qty > v_item.quantity - v_returned THEN
      RAISE EXCEPTION 'Só pode devolver % de %.', v_item.quantity - v_returned, v_item.product_name
        USING ERRCODE = '22023';
    END IF;

    v_amount := public._pos_round(v_item.total * v_qty / v_item.quantity);
    v_total := v_total + v_amount;
    v_items := v_items || jsonb_build_object('item', to_jsonb(v_item), 'quantity', v_qty, 'amount', v_amount);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Escolha os artigos a devolver.' USING ERRCODE = '22023';
  END IF;

  IF v_method IS NULL THEN
    SELECT CASE WHEN count(DISTINCT method) = 1 THEN min(method) ELSE 'cash' END
      INTO v_method FROM pos_payments WHERE invoice_id = v_inv.id AND amount > 0;
  END IF;
  IF v_method NOT IN ('cash', 'mpesa', 'emola', 'card', 'transfer') THEN
    RAISE EXCEPTION 'Método de devolução inválido.' USING ERRCODE = '22023';
  END IF;

  v_auth := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                'refund', p_auth_pin,
                                jsonb_build_object('number', v_inv.invoice_number, 'amount', v_total, 'reason', p_reason),
                                v_inv.id);

  INSERT INTO invoices (company_id, client_id, invoice_number, document_type, origin, date, subtotal, total,
                        amount_paid, amount_pending, status, created_by, related_invoice_id, credit_reason,
                        pos_session_id, pos_terminal_id, pos_staff_id, table_label)
  VALUES (c.company_id, v_inv.client_id, '', 'NC', 'pos', (now() AT TIME ZONE 'Africa/Maputo')::date,
          -v_total, -v_total, 0, 0, 'paga', (SELECT id FROM profiles WHERE id = c.staff_user_id),
          v_inv.id, left(btrim(p_reason), 500), v_session, c.terminal_id, c.staff_id, v_inv.table_label)
  RETURNING id INTO v_nc;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal, total,
                               discount, source_item_id)
    VALUES (v_nc, (v_line #>> '{item,product_id}')::uuid, v_line #>> '{item,product_name}',
            -(v_line ->> 'quantity')::numeric, (v_line #>> '{item,unit_price}')::numeric,
            -(v_line ->> 'amount')::numeric, -(v_line ->> 'amount')::numeric,
            -public._pos_round((v_line #>> '{item,discount}')::numeric * (v_line ->> 'quantity')::numeric
                               / (v_line #>> '{item,quantity}')::numeric),
            (v_line #>> '{item,id}')::uuid);
  END LOOP;

  INSERT INTO pos_payments (company_id, invoice_id, session_id, method, amount, simulated, staff_id)
  VALUES (c.company_id, v_nc, v_session, v_method, -v_total, v_method IN ('mpesa', 'emola'), c.staff_id);

  PERFORM public._apply_invoice_stock(v_nc, false, true);

  PERFORM public._pos_audit(c.company_id, 'POS: Emitiu Nota de Crédito', v_nc,
    (SELECT invoice_number FROM invoices WHERE id = v_nc),
    jsonb_build_object('total', -v_total, 'origin', v_inv.invoice_number, 'reason', p_reason,
                       'staff', c.staff_name, 'authorized_by', (SELECT name FROM pos_staff WHERE id = v_auth)));

  RETURN public._pos_document(v_nc);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_issue_nc(text, uuid, jsonb, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Permissões da Data API (o Supabase deixou de as dar automaticamente)
-- ---------------------------------------------------------------------------
-- Só leitura (relatórios na aplicação); tudo se escreve pelas funções pos_*.
-- As sessões de operador não são acessíveis pela API.
GRANT SELECT ON public.pos_sessions, public.pos_cash_movements, public.pos_payment_requests,
                public.pos_payments, public.pos_authorizations TO authenticated;
GRANT ALL ON public.pos_operator_sessions, public.pos_sessions, public.pos_cash_movements,
             public.pos_payment_requests, public.pos_payments, public.pos_authorizations TO service_role;
