/*
  # Anulação de recibos

  Eliminar um pagamento deixava um buraco na série de recibos (REC00031,
  REC00033, ...). Os recibos passam a ser anulados, como as facturas: o
  documento continua a existir, com o mesmo número, marcado como anulado.

  1. `payments`
    - `status` ('emitido' | 'anulado', default 'emitido')
    - `annulled_at`, `annulled_by`, `annulment_reason`

  2. Totais da factura
    - `amount_paid` / `amount_pending` passam a contar só recibos emitidos e
      são recalculados também quando um recibo muda de estado.
    - Uma factura anulada mantém os totais a zero (definidos ao anular).

  3. `annul_payment(payment_id, reason)`
    - Único caminho para anular. Exige motivo e o papel Proprietário, Admin
      ou Gestor. Actualiza o estado da factura (paga → pendente/vencida).

  4. A política de eliminação de pagamentos é removida. A eliminação em
     cascata de uma factura continua a funcionar (não passa pelo RLS).
*/

-- 1. Colunas -----------------------------------------------------------------

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'emitido',
  ADD COLUMN IF NOT EXISTS annulled_at timestamptz,
  ADD COLUMN IF NOT EXISTS annulled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS annulment_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_status_check CHECK (status IN ('emitido', 'anulado'));
  END IF;
END $$;

-- 2. Papel do utilizador na empresa -------------------------------------------

CREATE OR REPLACE FUNCTION public.has_company_role(p_company_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    'owner' = ANY (p_roles) AND EXISTS (
      SELECT 1 FROM public.companies c
       WHERE c.id = p_company_id AND c.user_id = auth.uid()
    )
  ) OR EXISTS (
    SELECT 1 FROM public.company_users cu
     WHERE cu.company_id = p_company_id
       AND cu.user_id = auth.uid()
       AND COALESCE(cu.is_active, true)
       AND cu.role = ANY (p_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, text[]) TO authenticated;

-- 3. Totais da factura --------------------------------------------------------

CREATE OR REPLACE FUNCTION update_invoice_payment_amounts()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_paid numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM payments
   WHERE invoice_id = v_invoice_id
     AND status = 'emitido';

  UPDATE invoices
     SET amount_paid = v_paid,
         amount_pending = total - v_paid
   WHERE id = v_invoice_id
     AND status <> 'anulada';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS update_invoice_amounts_on_payment_status ON payments;
CREATE TRIGGER update_invoice_amounts_on_payment_status
  AFTER UPDATE OF status ON payments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_invoice_payment_amounts();

-- 4. Anular um recibo ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.annul_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_invoice invoices%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_new_status text;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recibo não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_company_role(v_payment.company_id, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'Sem permissão para anular recibos desta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_payment.status = 'anulado' THEN
    RAISE EXCEPTION 'O recibo % já está anulado', v_payment.receipt_number USING ERRCODE = '22023';
  END IF;

  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Indique o motivo da anulação' USING ERRCODE = '22023';
  END IF;

  UPDATE payments
     SET status = 'anulado',
         annulled_at = now(),
         annulled_by = auth.uid(),
         annulment_reason = left(v_reason, 500)
   WHERE id = p_payment_id;

  -- O trigger já recalculou os totais. Falta o estado da factura.
  SELECT * INTO v_invoice FROM invoices WHERE id = v_payment.invoice_id;

  IF v_invoice.status IN ('paga', 'pendente', 'vencida') THEN
    v_new_status := CASE
      WHEN v_invoice.total > 0 AND v_invoice.amount_paid >= v_invoice.total THEN 'paga'
      WHEN v_invoice.due_date IS NOT NULL AND v_invoice.due_date < CURRENT_DATE THEN 'vencida'
      ELSE 'pendente'
    END;

    IF v_new_status <> v_invoice.status THEN
      UPDATE invoices SET status = v_new_status WHERE id = v_invoice.id;
    END IF;
  ELSE
    v_new_status := v_invoice.status;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'receipt_number', v_payment.receipt_number,
    'amount', v_payment.amount,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'invoice_status', v_new_status,
    'amount_paid', v_invoice.amount_paid,
    'amount_pending', v_invoice.amount_pending
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.annul_payment(uuid, text) TO authenticated;

-- 5. Sem eliminação directa ---------------------------------------------------

DROP POLICY IF EXISTS "Users can delete payments from their company" ON payments;
