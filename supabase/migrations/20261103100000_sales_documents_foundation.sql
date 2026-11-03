/*
  # Documentos de venda: fundação para o Ponto de Venda (POS) — Fase 1

  1. Tipos de documento em `invoices`
    - `document_type`: 'FT' (factura, como até agora), 'FR' (factura-recibo,
      emitida pelo POS) e 'NC' (nota de crédito).
    - `origin`: 'app' ou 'pos'.
    - As notas de crédito são gravadas com valores NEGATIVOS (total, subtotal e
      linhas). Assim o ISPC, o Painel, os relatórios e as análises, que somam
      `invoices.total`, passam a subtrair as devoluções sem alteração.
    - `related_invoice_id` (NC → documento de origem), `credit_reason`,
      `discount_total`.

  2. Numeração no servidor
    - Até agora o número da factura era calculado no browser e o contador da
      empresa incrementado depois, sem garantia de unicidade. Passa a ser
      atribuído por trigger, com a linha da empresa (FT) ou da série (FR/NC)
      bloqueada até ao fim da transacção, como já acontece nos recibos.
    - FT mantém o formato e o contador actuais (`invoice_prefix` +
      `invoice_number`, ex.: FAC00042). FR e NC usam `document_series`, uma
      série por tipo e por ano: FR 2026/00001.
    - O número, o tipo e a origem de um documento emitido não podem mudar.
    - O número enviado pelo cliente é ignorado. A aplicação deixa de
      incrementar `companies.invoice_number` (tem de ser publicada em
      simultâneo com esta migração para não saltar números).

  3. Cliente "Consumidor final"
    - `clients.is_walk_in`: um cliente técnico por empresa, criado a pedido
      (`get_walk_in_client`), que não conta para o limite de clientes.

  4. Linhas: `discount`, `unit_cost`, `notes`.

  5. Stock com histórico
    - `stock_movements` regista cada entrada e saída.
    - `apply_invoice_stock(invoice_id, reverse)` aplica ou reverte o stock de
      um documento numa transacção, de forma idempotente.

  6. Regras de anulação
    - FR: só no próprio dia (depois disso, nota de crédito) e sem NC activa.
    - NC: não se anula.
    - FT: regras actuais.

  7. Subscrição
    - Funcionalidades `pos`, `max_pos_terminals`, `max_pos_staff`.
    - `company_feature_overrides`: activar uma funcionalidade numa empresa fora
      do plano (pilotos), gerido no backoffice.
    - `platform_settings.pos_grace_days` (5): dias de tolerância do POS após a
      subscrição expirar. `company_pos_access()` devolve o estado.
    - As notas de crédito e os documentos do POS não contam para
      `max_invoices_month`.

  8. Extractos de cliente: só contam facturas (FT). Uma FR do POS já nasce
     paga e uma NC do POS é devolvida no acto, por isso não geram saldo.
*/

-- ---------------------------------------------------------------------------
-- 1. Tipos de documento
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'FT',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS related_invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS credit_reason text,
  ADD COLUMN IF NOT EXISTS discount_total numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_document_type_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_document_type_check CHECK (document_type IN ('FT', 'FR', 'NC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_origin_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_origin_check CHECK (origin IN ('app', 'pos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_credit_note_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_credit_note_check CHECK (
        document_type <> 'NC' OR (total <= 0 AND related_invoice_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_company_type_date
  ON public.invoices (company_id, document_type, date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_related
  ON public.invoices (related_invoice_id) WHERE related_invoice_id IS NOT NULL;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- 2. Numeração
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('FR', 'NC')),
  year integer NOT NULL,
  prefix text NOT NULL DEFAULT '',
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_type, year)
);

ALTER TABLE public.document_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view document series" ON public.document_series;
CREATE POLICY "Members can view document series" ON public.document_series
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id) OR public.is_admin());

-- Escritas só pelo trigger de numeração (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_company_id uuid,
  p_document_type text,
  p_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_number integer;
  v_year integer := EXTRACT(YEAR FROM COALESCE(p_date, CURRENT_DATE))::integer;
BEGIN
  IF p_document_type = 'FT' THEN
    UPDATE companies
       SET invoice_number = COALESCE(invoice_number, 1) + 1
     WHERE id = p_company_id
    RETURNING COALESCE(invoice_prefix, 'FAC'), invoice_number - 1
      INTO v_prefix, v_number;

    IF v_number IS NULL THEN
      RAISE EXCEPTION 'Empresa % não encontrada', p_company_id;
    END IF;

    RETURN v_prefix || lpad(v_number::text, GREATEST(5, length(v_number::text)), '0');
  END IF;

  INSERT INTO document_series (company_id, document_type, year, prefix, next_number)
  VALUES (p_company_id, p_document_type, v_year, p_document_type, 2)
  ON CONFLICT (company_id, document_type, year)
  DO UPDATE SET next_number = document_series.next_number + 1,
                updated_at = now()
  RETURNING prefix, next_number - 1
    INTO v_prefix, v_number;

  RETURN v_prefix || ' ' || v_year || '/'
      || lpad(v_number::text, GREATEST(5, length(v_number::text)), '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rascunho' THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.invoice_number, '') = '' THEN
      NEW.invoice_number := 'RSC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR OLD.status = 'rascunho' THEN
    NEW.invoice_number := public.next_document_number(NEW.company_id, NEW.document_type, NEW.date);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_invoice_number ON public.invoices;
CREATE TRIGGER trg_assign_invoice_number
  BEFORE INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

CREATE OR REPLACE FUNCTION public.freeze_issued_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'rascunho' THEN
    NEW.invoice_number := OLD.invoice_number;
    NEW.document_type := OLD.document_type;
    NEW.origin := OLD.origin;
    NEW.company_id := OLD.company_id;
    NEW.related_invoice_id := OLD.related_invoice_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_issued_invoice ON public.invoices;
CREATE TRIGGER trg_freeze_issued_invoice
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.freeze_issued_invoice();

-- Unicidade do número por empresa. Se já existirem números repetidos (o risco
-- que esta migração corrige), o índice não é criado e fica um aviso: os
-- duplicados têm de ser revistos manualmente antes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
     WHERE status <> 'rascunho'
     GROUP BY company_id, invoice_number
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_key
      ON public.invoices (company_id, invoice_number)
      WHERE status <> 'rascunho';
  ELSE
    RAISE WARNING 'Há números de factura repetidos: o índice único invoices_company_number_key não foi criado.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Consumidor final
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_walk_in boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS clients_one_walk_in_per_company
  ON public.clients (company_id) WHERE is_walk_in;

-- Interna: sem verificação de acesso (usada por outras funções SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public._ensure_walk_in_client(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM clients WHERE company_id = p_company_id AND is_walk_in;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO clients (company_id, name, is_walk_in, is_active, notes)
  VALUES (p_company_id, 'Consumidor final', true, true, 'Cliente técnico das vendas sem NUIT.')
  ON CONFLICT (company_id) WHERE is_walk_in DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM clients WHERE company_id = p_company_id AND is_walk_in;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._ensure_walk_in_client(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_walk_in_client(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_company_member(p_company_id) OR public.has_company_role(p_company_id, ARRAY['owner'])) THEN
    RAISE EXCEPTION 'Sem acesso à empresa' USING ERRCODE = '42501';
  END IF;
  RETURN public._ensure_walk_in_client(p_company_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_walk_in_client(uuid) TO authenticated;

-- O consumidor final não conta para o limite de clientes.
CREATE OR REPLACE FUNCTION public.enforce_resource_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint; v_code text;
BEGIN
  -- IF aninhado: NEW.is_walk_in só existe em clients.
  IF TG_TABLE_NAME = 'clients' THEN
    IF NEW.is_walk_in THEN
      RETURN NEW;
    END IF;
  END IF;
  v_code := CASE TG_TABLE_NAME WHEN 'clients' THEN 'max_clients' ELSE 'max_products' END;
  v_count := CASE TG_TABLE_NAME
    WHEN 'clients' THEN (SELECT count(*) FROM public.clients WHERE company_id = NEW.company_id AND NOT is_walk_in)
    ELSE (SELECT count(*) FROM public.products WHERE company_id = NEW.company_id)
  END;
  PERFORM public.assert_subscription_limit(NEW.company_id, v_code, v_count, 1);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Stock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('document', 'reversal', 'adjustment')),
  quantity numeric(12,3) NOT NULL,
  stock_after numeric,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_invoice ON public.stock_movements (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_company ON public.stock_movements (company_id, created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view stock movements" ON public.stock_movements;
CREATE POLICY "Members can view stock movements" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

/*
  Aplica (p_reverse = false) ou reverte (true) o stock de um documento.
  - Quantidade do movimento = -quantidade da linha (FT/FR saem do stock; as
    linhas de uma NC são negativas, por isso voltam a entrar). A reversão
    inverte o sinal.
  - Só produtos do tipo 'produto' com stock controlado (stock não nulo).
  - Idempotente: aplicar duas vezes, ou reverter sem ter aplicado, não faz nada.
  - p_allow_negative = false mantém a regra da aplicação: se não houver stock
    suficiente, essa linha não mexe no stock.
*/
CREATE OR REPLACE FUNCTION public._apply_invoice_stock(
  p_invoice_id uuid,
  p_reverse boolean DEFAULT false,
  p_allow_negative boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_applied integer;
  v_reversed integer;
  v_sign integer := CASE WHEN p_reverse THEN 1 ELSE -1 END;
  v_count integer := 0;
  r record;
  v_stock numeric;
  v_delta numeric;
BEGIN
  SELECT company_id INTO v_company_id FROM invoices WHERE id = p_invoice_id;
  IF v_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Serializa as operações sobre o mesmo documento.
  PERFORM 1 FROM invoices WHERE id = p_invoice_id FOR UPDATE;

  SELECT count(*) FILTER (WHERE movement_type = 'document'),
         count(*) FILTER (WHERE movement_type = 'reversal')
    INTO v_applied, v_reversed
    FROM stock_movements WHERE invoice_id = p_invoice_id;

  IF NOT p_reverse AND v_applied > 0 THEN RETURN 0; END IF;
  IF p_reverse AND (v_applied = 0 OR v_reversed > 0) THEN RETURN 0; END IF;

  FOR r IN
    SELECT ii.product_id, sum(ii.quantity) AS quantity
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id = p_invoice_id
       AND p.type = 'produto'
       AND p.stock IS NOT NULL
     GROUP BY ii.product_id
  LOOP
    IF p_reverse THEN
      -- Reverte exactamente o que foi aplicado (pode ter sido ignorado por falta de stock).
      SELECT -sum(quantity) INTO v_delta
        FROM stock_movements
       WHERE invoice_id = p_invoice_id AND product_id = r.product_id AND movement_type = 'document';
      IF v_delta IS NULL OR v_delta = 0 THEN CONTINUE; END IF;
    ELSE
      v_delta := v_sign * r.quantity;
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = r.product_id FOR UPDATE;

    IF NOT p_allow_negative AND v_delta < 0 AND v_stock + v_delta < 0 THEN
      CONTINUE;
    END IF;

    UPDATE products SET stock = stock + v_delta WHERE id = r.product_id;

    INSERT INTO stock_movements (company_id, product_id, invoice_id, movement_type, quantity, stock_after)
    VALUES (v_company_id, r.product_id, p_invoice_id,
            CASE WHEN p_reverse THEN 'reversal' ELSE 'document' END,
            v_delta, v_stock + v_delta);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_invoice_stock(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_invoice_stock(p_invoice_id uuid, p_reverse boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_status text;
BEGIN
  SELECT company_id, status INTO v_company_id, v_status FROM invoices WHERE id = p_invoice_id;
  IF v_company_id IS NULL OR NOT public.is_company_member(v_company_id) THEN
    RAISE EXCEPTION 'Documento não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_reverse AND v_status IN ('rascunho', 'anulada') THEN
    RETURN 0;
  END IF;
  IF p_reverse AND v_status <> 'anulada' THEN
    RAISE EXCEPTION 'Só se repõe o stock de um documento anulado' USING ERRCODE = '22023';
  END IF;
  RETURN public._apply_invoice_stock(p_invoice_id, p_reverse, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_invoice_stock(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Regras de anulação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_invalid_invoice_annulment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
BEGIN
  IF NEW.status = 'anulada' AND OLD.status IS DISTINCT FROM 'anulada' THEN
    IF OLD.document_type = 'NC' THEN
      RAISE EXCEPTION 'Uma nota de crédito não pode ser anulada.';
    END IF;

    IF OLD.document_type = 'FR' THEN
      IF OLD.date <> today THEN
        RAISE EXCEPTION 'Uma factura-recibo só pode ser anulada no próprio dia. Emita uma nota de crédito.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.invoices nc
         WHERE nc.related_invoice_id = OLD.id
           AND nc.status <> 'anulada'
      ) THEN
        RAISE EXCEPTION 'Esta factura-recibo tem notas de crédito e já não pode ser anulada.';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.status = 'paga' OR COALESCE(OLD.amount_paid, 0) > 0 THEN
      RAISE EXCEPTION 'Uma factura com pagamentos não pode ser anulada. Anule primeiro os recibos.';
    END IF;

    IF date_trunc('quarter', OLD.date) <> date_trunc('quarter', today) THEN
      RAISE EXCEPTION 'Uma factura de um trimestre já encerrado não pode ser anulada.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- As notas de crédito não consomem a quota de facturas do plano.
CREATE OR REPLACE FUNCTION public.enforce_invoice_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF NEW.status IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;
  IF NEW.document_type = 'NC' THEN RETURN NEW; END IF;
  -- O POS está só nos planos sem limite de facturas e é controlado por
  -- company_pos_access (incluindo a tolerância, em que o plano em vigor
  -- passaria a ser o Trial).
  IF NEW.origin = 'pos' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;

  PERFORM public.assert_subscription_feature(NEW.company_id, 'invoicing');

  v_count := (
    SELECT count(*) FROM public.invoices i
     WHERE i.company_id = NEW.company_id
       AND i.status NOT IN ('rascunho', 'anulada')
       AND i.document_type <> 'NC'
       AND i.date >= date_trunc('month', CURRENT_DATE)::date
       AND i.date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
  );
  PERFORM public.assert_subscription_limit(NEW.company_id, 'max_invoices_month', v_count, 1);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Funcionalidades, excepções por empresa e tolerância do POS
-- ---------------------------------------------------------------------------
INSERT INTO public.subscription_features (code, name, description, value_type, scope, unit, sort_order)
VALUES
  ('pos', 'Ponto de Venda (POS)', 'Permite usar o Ponto de Venda para lojas e restaurantes.', 'boolean', 'company', NULL, 15),
  ('max_pos_terminals', 'Terminais POS', 'Limite de terminais (caixas) activos por empresa.', 'limit', 'company', 'terminais', 16),
  ('max_pos_staff', 'Funcionários POS', 'Limite de funcionários (caixas e empregados) activos por empresa.', 'limit', 'company', 'funcionários', 17)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  scope = EXCLUDED.scope,
  unit = EXCLUDED.unit,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.company_feature_overrides (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature_code text NOT NULL REFERENCES public.subscription_features(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  limit_value bigint,
  notes text,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, feature_code)
);

ALTER TABLE public.company_feature_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage feature overrides" ON public.company_feature_overrides;
CREATE POLICY "Admins manage feature overrides" ON public.company_feature_overrides
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Members view own feature overrides" ON public.company_feature_overrides;
CREATE POLICY "Members view own feature overrides" ON public.company_feature_overrides
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

-- Agora com as excepções por empresa: a excepção prevalece sobre o plano.
CREATE OR REPLACE FUNCTION public.subscription_feature_value(
  p_company_id uuid,
  p_feature_code text
)
RETURNS TABLE(enabled boolean, limit_value bigint, value_type text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(o.enabled, pf.enabled),
         CASE WHEN o.company_id IS NOT NULL THEN o.limit_value ELSE pf.limit_value END,
         f.value_type,
         f.scope
    FROM public.subscription_features f
    LEFT JOIN public.subscription_plan_features pf
      ON pf.feature_id = f.id
     AND pf.plan_id = public.subscription_plan_for_company(p_company_id)
    LEFT JOIN public.company_feature_overrides o
      ON o.company_id = p_company_id
     AND o.feature_code = f.code
   WHERE f.code = p_feature_code
     AND f.is_active = true
     AND (pf.feature_id IS NOT NULL OR o.company_id IS NOT NULL)
   LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read platform settings" ON public.platform_settings;
CREATE POLICY "Authenticated read platform settings" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage platform settings" ON public.platform_settings;
CREATE POLICY "Admins manage platform settings" ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.platform_settings (key, value, description)
VALUES ('pos_grace_days', '5'::jsonb, 'Dias em que o POS continua a vender depois de a subscrição expirar.')
ON CONFLICT (key) DO NOTHING;

/*
  Estado do POS de uma empresa:
    enabled      a funcionalidade 'pos' está no plano da última subscrição
                 (ou numa excepção da empresa)
    active       a subscrição está em vigor
    in_grace     expirou há no máximo pos_grace_days (ou o valor da excepção
                 'pos_grace_days' da empresa, guardado em limit_value)
    allowed      enabled e (active ou in_grace)
  Durante a tolerância usa-se o plano da última subscrição, não o Trial.
*/
CREATE OR REPLACE FUNCTION public.company_pos_access(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
  v_grace integer;
  v_enabled boolean;
  v_active boolean;
  v_in_grace boolean := false;
  v_grace_until date;
BEGIN
  SELECT s.plan_id, s.status, s.end_date
    INTO v_sub
    FROM subscriptions s
   WHERE s.company_id = p_company_id
   ORDER BY (s.status IN ('active', 'trialing')) DESC, s.end_date DESC NULLS FIRST, s.updated_at DESC
   LIMIT 1;

  SELECT COALESCE(o.enabled, pf.enabled, false)
    INTO v_enabled
    FROM subscription_features f
    LEFT JOIN subscription_plan_features pf ON pf.feature_id = f.id AND pf.plan_id = v_sub.plan_id
    LEFT JOIN company_feature_overrides o ON o.company_id = p_company_id AND o.feature_code = f.code
   WHERE f.code = 'pos' AND f.is_active;
  v_enabled := COALESCE(v_enabled, false);

  v_grace := COALESCE(
    (SELECT (value #>> '{}')::integer FROM platform_settings WHERE key = 'pos_grace_days'),
    5
  );

  v_active := v_sub.status IN ('active', 'trialing')
              AND (v_sub.end_date IS NULL OR v_sub.end_date >= v_today);

  IF NOT COALESCE(v_active, false) AND v_sub.end_date IS NOT NULL
     AND v_sub.status IN ('active', 'trialing', 'past_due') THEN
    v_grace_until := v_sub.end_date + v_grace;
    v_in_grace := v_today <= v_grace_until;
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'active', COALESCE(v_active, false),
    'in_grace', v_in_grace,
    'grace_until', v_grace_until,
    'end_date', v_sub.end_date,
    'allowed', v_enabled AND (COALESCE(v_active, false) OR v_in_grace)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_pos_access(uuid) TO authenticated;

-- Documentos do POS seguem a tolerância do POS; o resto, as regras actuais.
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
-- 7. Extractos de cliente: só facturas (FT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_statement_summary(p_company_id uuid, p_start date, p_end date, p_client_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(client_id uuid, client_code text, client_name text, client_nuit text, opening_balance numeric, total_invoiced numeric, total_paid numeric, balance numeric, overdue_amount numeric, invoice_count integer, receipt_count integer, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_ref_date date;
BEGIN
  IF NOT public.can_view_client_statements(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para consultar extractos desta empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  v_ref_date := LEAST(p_end, CURRENT_DATE);

  RETURN QUERY
  WITH valid_invoices AS (
    SELECT i.id, i.client_id, i.date, i.due_date, i.total
      FROM public.invoices i
     WHERE i.company_id = p_company_id
       AND i.status NOT IN ('rascunho', 'anulada')
       AND i.document_type = 'FT'
       AND i.date <= p_end
  ),
  valid_payments AS (
    SELECT p.invoice_id, vi.client_id, p.payment_date, p.amount
      FROM public.payments p
      JOIN valid_invoices vi ON vi.id = p.invoice_id
     WHERE p.company_id = p_company_id
       AND p.status = 'emitido'
       AND p.payment_date <= p_end
  ),
  inv AS (
    SELECT vi.client_id,
           COALESCE(sum(vi.total) FILTER (WHERE vi.date < p_start), 0) AS before_start,
           COALESCE(sum(vi.total) FILTER (WHERE vi.date >= p_start), 0) AS in_period,
           count(*) FILTER (WHERE vi.date >= p_start) AS n
      FROM valid_invoices vi
     GROUP BY vi.client_id
  ),
  pay AS (
    SELECT vp.client_id,
           COALESCE(sum(vp.amount) FILTER (WHERE vp.payment_date < p_start), 0) AS before_start,
           COALESCE(sum(vp.amount) FILTER (WHERE vp.payment_date >= p_start), 0) AS in_period,
           count(*) FILTER (WHERE vp.payment_date >= p_start) AS n
      FROM valid_payments vp
     GROUP BY vp.client_id
  ),
  overdue AS (
    -- Valor em atraso na data de referência, factura a factura.
    SELECT vi.client_id,
           sum(vi.total - COALESCE(paid.amount, 0)) AS amount
      FROM valid_invoices vi
      LEFT JOIN LATERAL (
        SELECT sum(vp.amount) AS amount
          FROM valid_payments vp
         WHERE vp.invoice_id = vi.id
           AND vp.payment_date <= v_ref_date
      ) paid ON true
     WHERE vi.due_date IS NOT NULL
       AND vi.due_date < v_ref_date
       AND vi.total - COALESCE(paid.amount, 0) > 0.005
     GROUP BY vi.client_id
  ),
  summary AS (
    SELECT c.id,
           c.client_code,
           c.name,
           c.nuit,
           ROUND(COALESCE(inv.before_start, 0) - COALESCE(pay.before_start, 0), 2) AS opening,
           ROUND(COALESCE(inv.in_period, 0), 2) AS invoiced,
           ROUND(COALESCE(pay.in_period, 0), 2) AS paid,
           ROUND(COALESCE(overdue.amount, 0), 2) AS overdue_amount,
           COALESCE(inv.n, 0)::integer AS invoice_count,
           COALESCE(pay.n, 0)::integer AS receipt_count
      FROM public.clients c
      LEFT JOIN inv ON inv.client_id = c.id
      LEFT JOIN pay ON pay.client_id = c.id
      LEFT JOIN overdue ON overdue.client_id = c.id
     WHERE c.company_id = p_company_id
       AND (p_client_ids IS NULL OR c.id = ANY (p_client_ids))
  )
  -- Conversões explícitas: RETURN QUERY exige os tipos exactos da assinatura.
  SELECT r.id,
         r.client_code::text,
         r.name::text,
         r.nuit::text,
         r.opening::numeric,
         r.invoiced::numeric,
         r.paid::numeric,
         (r.opening + r.invoiced - r.paid)::numeric,
         r.overdue_amount::numeric,
         r.invoice_count,
         r.receipt_count,
         CASE
           WHEN r.opening + r.invoiced - r.paid <= 0.005 THEN 'pago'
           WHEN r.overdue_amount > 0 THEN 'vencido'
           ELSE 'em_divida'
         END::text
    FROM summary r
   ORDER BY r.client_code NULLS LAST, r.name;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.client_statement_movements(p_company_id uuid, p_client_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client jsonb;
  v_opening numeric;
  v_movements jsonb;
BEGIN
  IF NOT public.can_view_client_statements(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para consultar extractos desta empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
           'id', c.id,
           'client_code', c.client_code,
           'name', c.name,
           'nuit', c.nuit,
           'address', c.address,
           'phone', c.phone,
           'email', c.email
         )
    INTO v_client
    FROM public.clients c
   WHERE c.id = p_client_id
     AND c.company_id = p_company_id;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta empresa' USING ERRCODE = 'P0002';
  END IF;

  -- Saldo anterior
  SELECT COALESCE((
           SELECT sum(i.total)
             FROM public.invoices i
            WHERE i.company_id = p_company_id
              AND i.client_id = p_client_id
              AND i.status NOT IN ('rascunho', 'anulada')
              AND i.document_type = 'FT'
              AND i.date < p_start
         ), 0)
       - COALESCE((
           SELECT sum(p.amount)
             FROM public.payments p
             JOIN public.invoices i ON i.id = p.invoice_id
            WHERE p.company_id = p_company_id
              AND p.status = 'emitido'
              AND i.client_id = p_client_id
              AND i.status NOT IN ('rascunho', 'anulada')
              AND i.document_type = 'FT'
              AND p.payment_date < p_start
         ), 0)
    INTO v_opening;

  -- Movimentos do período. No mesmo dia, a factura aparece antes do recibo.
  SELECT COALESCE(jsonb_agg(m.row ORDER BY m.sort_date, m.sort_kind, m.created_at), '[]'::jsonb)
    INTO v_movements
    FROM (
      SELECT i.date AS sort_date,
             0 AS sort_kind,
             i.created_at,
             jsonb_build_object(
               'kind', 'factura',
               'date', i.date,
               'document', i.invoice_number,
               'invoice_id', i.id,
               'invoice_number', i.invoice_number,
               'payment_id', NULL,
               'due_date', i.due_date,
               'first_item', (
                 SELECT ii.product_name
                   FROM public.invoice_items ii
                  WHERE ii.invoice_id = i.id
                  ORDER BY ii.created_at NULLS LAST, ii.id
                  LIMIT 1
               ),
               'item_count', (
                 SELECT count(*) FROM public.invoice_items ii WHERE ii.invoice_id = i.id
               ),
               'invoiced', ROUND(i.total, 2),
               'paid', 0
             ) AS row
        FROM public.invoices i
       WHERE i.company_id = p_company_id
         AND i.client_id = p_client_id
         AND i.status NOT IN ('rascunho', 'anulada')
         AND i.document_type = 'FT'
         AND i.date BETWEEN p_start AND p_end

      UNION ALL

      SELECT p.payment_date,
             1,
             p.created_at,
             jsonb_build_object(
               'kind', 'recibo',
               'date', p.payment_date,
               'document', p.receipt_number,
               'invoice_id', i.id,
               'invoice_number', i.invoice_number,
               'payment_id', p.id,
               'payment_method', p.payment_method,
               'reference', p.reference,
               'invoiced', 0,
               'paid', ROUND(p.amount, 2)
             )
        FROM public.payments p
        JOIN public.invoices i ON i.id = p.invoice_id
       WHERE p.company_id = p_company_id
         AND p.status = 'emitido'
         AND i.client_id = p_client_id
         AND i.status NOT IN ('rascunho', 'anulada')
         AND i.document_type = 'FT'
         AND p.payment_date BETWEEN p_start AND p_end
    ) m;

  RETURN jsonb_build_object(
    'client', v_client,
    'opening_balance', ROUND(v_opening, 2),
    'movements', v_movements
  );
END;
$function$

;


-- ---------------------------------------------------------------------------
-- 8. Permissões da Data API (o Supabase deixou de as dar automaticamente)
-- ---------------------------------------------------------------------------
-- Séries e movimentos de stock: só leitura; escrevem-se pelas funções.
GRANT SELECT ON public.document_series TO authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;
-- Excepções e definições da plataforma: o RLS limita a escrita aos admins.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_feature_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_settings TO authenticated;
GRANT ALL ON public.document_series, public.stock_movements, public.company_feature_overrides,
             public.platform_settings TO service_role;
