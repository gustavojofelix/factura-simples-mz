/*
  # Data de emissão e dados de anulação nas facturas

  Necessários para o ficheiro SAF-T (SystemEntryDate, InvoiceStatusDate e
  Reason), à semelhança dos recibos (20260930105000).

  1. `invoices`
    - `issued_at`        momento em que a factura deixou de ser rascunho
    - `annulled_at`      momento da anulação
    - `annulled_by`      utilizador que anulou
    - `annulment_reason` motivo (opcional; a aplicação ainda não o pede)

  2. Trigger `trg_set_invoice_document_metadata`
    - Preenche `issued_at` ao inserir uma factura já emitida ou quando um
      rascunho é emitido; preenche `annulled_at`/`annulled_by` ao anular.
    - Só preenche valores em falta: não altera o que já estiver definido.

  3. Preenchimento dos dados existentes
    - `issued_at` = `created_at` (melhor aproximação disponível).
    - `annulled_at`/`annulled_by` a partir do registo de auditoria
      ('Anulou Factura') ou, na falta dele, de `updated_at`.
*/

-- 1. Colunas -----------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS annulled_at timestamptz,
  ADD COLUMN IF NOT EXISTS annulled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS annulment_reason text;

-- 2. Trigger ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_invoice_document_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'rascunho' AND NEW.issued_at IS NULL THEN
      NEW.issued_at := now();
    END IF;
  ELSE
    IF OLD.status = 'rascunho'
       AND NEW.status IS DISTINCT FROM 'rascunho'
       AND NEW.issued_at IS NULL THEN
      NEW.issued_at := now();
    END IF;
  END IF;

  IF NEW.status = 'anulada'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'anulada') THEN
    NEW.annulled_at := COALESCE(NEW.annulled_at, now());
    NEW.annulled_by := COALESCE(NEW.annulled_by, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_invoice_document_metadata ON public.invoices;
CREATE TRIGGER trg_set_invoice_document_metadata
  BEFORE INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_document_metadata();

-- 3. Dados existentes -----------------------------------------------------------
-- O preenchimento não deve mexer em updated_at.

ALTER TABLE public.invoices DISABLE TRIGGER update_invoices_updated_at;

UPDATE public.invoices i
   SET annulled_at = a.created_at,
       annulled_by = a.user_id
  FROM (
    SELECT DISTINCT ON (entity_id) entity_id, created_at, user_id
      FROM public.audit_logs
     WHERE action = 'Anulou Factura'
       AND entity_id IS NOT NULL
     ORDER BY entity_id, created_at DESC
  ) a
 WHERE a.entity_id = i.id::text
   AND i.status = 'anulada'
   AND i.annulled_at IS NULL;

UPDATE public.invoices
   SET annulled_at = COALESCE(updated_at, created_at)
 WHERE status = 'anulada'
   AND annulled_at IS NULL;

UPDATE public.invoices
   SET issued_at = created_at
 WHERE issued_at IS NULL
   AND status <> 'rascunho';

ALTER TABLE public.invoices ENABLE TRIGGER update_invoices_updated_at;
