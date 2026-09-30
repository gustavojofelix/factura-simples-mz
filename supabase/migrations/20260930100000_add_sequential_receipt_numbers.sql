/*
  # Numeração sequencial de recibos

  Até agora o número do recibo era derivado do identificador do pagamento
  (REC- + 8 caracteres do UUID). Passa a existir uma série sequencial por
  empresa, no mesmo formato das facturas: REC00001, REC00002, ...

  1. `companies`
    - `receipt_prefix` (text, default 'REC')
    - `receipt_next_number` (integer): próximo número a atribuir

  2. `payments`
    - `company_id` (uuid): empresa do recibo, copiada da factura. Evita o JOIN
      com `invoices` nos extractos e permite a unicidade por empresa.
    - `receipt_number` (text): número do recibo, único por empresa

  3. Atribuição
    - Trigger BEFORE INSERT atribui `company_id` e `receipt_number` no servidor.
      O incremento é feito com UPDATE ... RETURNING sobre a linha da empresa,
      que fica bloqueada até ao fim da transacção: dois pagamentos em
      simultâneo nunca recebem o mesmo número.
    - Valores enviados pelo cliente para estas colunas são ignorados.
    - Um trigger BEFORE UPDATE impede a alteração do número e da empresa.

  4. Recibos existentes
    - São numerados por empresa, por ordem de data do pagamento e de criação.
*/

-- 1. Colunas -----------------------------------------------------------------

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS receipt_prefix text NOT NULL DEFAULT 'REC',
  ADD COLUMN IF NOT EXISTS receipt_next_number integer NOT NULL DEFAULT 1;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS receipt_number text;

-- Formata o número com pelo menos 5 dígitos, sem cortar números maiores
-- (lpad sozinho truncaria 100000 para 10000).
CREATE OR REPLACE FUNCTION public.format_receipt_number(p_prefix text, p_number integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_prefix, 'REC')
    || lpad(p_number::text, GREATEST(5, length(p_number::text)), '0');
$$;

-- 2. Recibos existentes ------------------------------------------------------

UPDATE payments p
SET company_id = i.company_id
FROM invoices i
WHERE i.id = p.invoice_id
  AND p.company_id IS NULL;

WITH numbered AS (
  SELECT
    p.id,
    p.company_id,
    row_number() OVER (
      PARTITION BY p.company_id
      ORDER BY p.payment_date, p.created_at, p.id
    ) AS seq
  FROM payments p
  WHERE p.receipt_number IS NULL
)
UPDATE payments p
SET receipt_number = public.format_receipt_number(c.receipt_prefix, n.seq::integer)
FROM numbered n
JOIN companies c ON c.id = n.company_id
WHERE p.id = n.id;

UPDATE companies c
SET receipt_next_number = COALESCE((
  SELECT count(*) + 1 FROM payments p WHERE p.company_id = c.id
), 1);

ALTER TABLE payments
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN receipt_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_company_receipt_number_key
  ON payments(company_id, receipt_number);

CREATE INDEX IF NOT EXISTS idx_payments_company_date
  ON payments(company_id, payment_date);

-- 3. Atribuição automática ---------------------------------------------------

-- SECURITY DEFINER: um utilizador partilhado (ex.: Vendedor) pode registar
-- pagamentos mas não tem permissão para alterar a linha da empresa.
CREATE OR REPLACE FUNCTION public.assign_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_prefix text;
  v_number integer;
BEGIN
  SELECT company_id INTO v_company_id
  FROM invoices
  WHERE id = NEW.invoice_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura % não encontrada para o pagamento', NEW.invoice_id;
  END IF;

  UPDATE companies
  SET receipt_next_number = receipt_next_number + 1
  WHERE id = v_company_id
  RETURNING receipt_prefix, receipt_next_number - 1
  INTO v_prefix, v_number;

  NEW.company_id := v_company_id;
  NEW.receipt_number := public.format_receipt_number(v_prefix, v_number);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_receipt_number_on_payment_insert ON payments;
CREATE TRIGGER assign_receipt_number_on_payment_insert
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_receipt_number();

CREATE OR REPLACE FUNCTION public.protect_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.company_id := OLD.company_id;
  NEW.receipt_number := OLD.receipt_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_receipt_number_on_payment_update ON payments;
CREATE TRIGGER protect_receipt_number_on_payment_update
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_receipt_number();
