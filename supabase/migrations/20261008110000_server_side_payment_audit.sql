-- Auditoria de pagamentos feita na base de dados.
--
-- Antes, os pagamentos de facturas só eram auditados pelo browser (se o insert
-- em audit_logs falhasse, perdia-se em silêncio) e os pagamentos de subscrição
-- (M-Pesa / e-Mola) confirmados pelo sislog-webhook não eram auditados de todo.

CREATE OR REPLACE FUNCTION public.audit_actor_email(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT email FROM auth.users WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.audit_actor_email(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pagamentos de facturas (recibos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_payment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice record;
  v_user uuid := COALESCE(auth.uid(), NEW.created_by);
  v_receipt text := to_jsonb(NEW)->>'receipt_number';
BEGIN
  -- Lido depois de update_invoice_amounts_on_payment_insert (ordem alfabética dos triggers).
  SELECT i.company_id, i.invoice_number, i.total, i.amount_paid, i.amount_pending, i.status
    INTO v_invoice
    FROM public.invoices i
   WHERE i.id = NEW.invoice_id;

  INSERT INTO public.audit_logs (
    user_id, user_email, company_id, action, category, entity_id, entity_name, details
  ) VALUES (
    v_user,
    public.audit_actor_email(v_user),
    v_invoice.company_id,
    'Registou Pagamento',
    'payments',
    NEW.id::text,
    COALESCE(v_invoice.invoice_number, 'Pagamento') || ' · ' || to_char(NEW.amount, 'FM999G999G990D00') || ' MZN',
    jsonb_strip_nulls(jsonb_build_object(
      'receipt_number', v_receipt,
      'amount', NEW.amount,
      'payment_method', NEW.payment_method,
      'payment_date', NEW.payment_date,
      'reference', NEW.reference,
      'notes', NEW.notes,
      'invoice_id', NEW.invoice_id,
      'invoice_number', v_invoice.invoice_number,
      'invoice_total', v_invoice.total,
      'amount_paid', v_invoice.amount_paid,
      'amount_pending', v_invoice.amount_pending,
      'status', v_invoice.status
    ))
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A auditoria nunca deve impedir o registo do pagamento.
  RAISE WARNING 'audit_payment_insert falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_audit_payment_insert ON public.payments;
CREATE TRIGGER zz_audit_payment_insert
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_insert();

-- ---------------------------------------------------------------------------
-- Pagamentos de subscrição (Sislog M-Pesa / e-Mola)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_subscription_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_user uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_action := CASE NEW.status
    WHEN 'pending'   THEN 'Iniciou Pagamento de Subscrição'
    WHEN 'completed' THEN 'Pagamento de Subscrição Confirmado'
    WHEN 'failed'    THEN 'Pagamento de Subscrição Falhou'
    WHEN 'cancelled' THEN 'Pagamento de Subscrição Cancelado'
    ELSE 'Pagamento de Subscrição Actualizado'
  END;

  INSERT INTO public.audit_logs (
    user_id, user_email, company_id, action, category, entity_id, entity_name, details
  ) VALUES (
    v_user,
    COALESCE(public.audit_actor_email(v_user), 'Sistema (' || upper(NEW.payment_method) || ')'),
    NEW.company_id,
    v_action,
    'subscriptions',
    NEW.id::text,
    NEW.plan_name || ' · ' || to_char(NEW.amount, 'FM999G999G990D00') || ' ' || COALESCE(NEW.currency, 'MZN'),
    jsonb_strip_nulls(jsonb_build_object(
      'reference_code', NEW.reference_code,
      'amount', NEW.amount,
      'plan_name', NEW.plan_name,
      'billing_cycle', NEW.billing_cycle,
      'payment_method', NEW.payment_method,
      'phone_number', NEW.phone_number,
      'status', NEW.status,
      'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END
    ))
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_subscription_payment falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_audit_subscription_payment ON public.subscription_payments;
CREATE TRIGGER zz_audit_subscription_payment
  AFTER INSERT OR UPDATE OF status ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_subscription_payment();
