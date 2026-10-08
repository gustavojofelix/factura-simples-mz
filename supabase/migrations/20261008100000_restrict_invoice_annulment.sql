-- Uma factura com pagamentos (mesmo parciais), ou emitida num trimestre já
-- encerrado, não pode ser anulada. Os recibos anulam-se primeiro; amount_paid
-- só conta recibos não anulados.
CREATE OR REPLACE FUNCTION public.prevent_invalid_invoice_annulment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
BEGIN
  IF NEW.status = 'anulada' AND OLD.status IS DISTINCT FROM 'anulada' THEN
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

DROP TRIGGER IF EXISTS trg_prevent_invalid_invoice_annulment ON public.invoices;
CREATE TRIGGER trg_prevent_invalid_invoice_annulment
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invalid_invoice_annulment();
