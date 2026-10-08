-- Composite index for "latest activity of a company" queries
-- (dashboard "Actividades Recentes": WHERE company_id = ? ORDER BY created_at DESC LIMIT n)
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON public.audit_logs (company_id, created_at DESC);
