-- Migration: Add OfficeGest sync tracking to subscription_payments
-- Rastreia quais pagamentos já foram sincronizados com o OfficeGest

ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS officegest_document_id   text,
  ADD COLUMN IF NOT EXISTS officegest_document_number text,
  ADD COLUMN IF NOT EXISTS officegest_synced_at     timestamptz,
  ADD COLUMN IF NOT EXISTS officegest_customer_id   text;

-- Índice para queries rápidas de "não sincronizados"
CREATE INDEX IF NOT EXISTS idx_sub_payments_officegest_doc
  ON subscription_payments(officegest_document_id)
  WHERE officegest_document_id IS NULL;

COMMENT ON COLUMN subscription_payments.officegest_document_id
  IS 'ID interno do documento criado no OfficeGest (null = ainda não sincronizado)';

COMMENT ON COLUMN subscription_payments.officegest_document_number
  IS 'Número do documento legível (ex: FT 2026/1234)';

COMMENT ON COLUMN subscription_payments.officegest_customer_id
  IS 'ID do cliente no OfficeGest correspondente à empresa';

COMMENT ON COLUMN subscription_payments.officegest_synced_at
  IS 'Timestamp da última sincronização com OfficeGest';
