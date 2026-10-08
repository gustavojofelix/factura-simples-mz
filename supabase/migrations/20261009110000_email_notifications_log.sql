-- Notificações por e-mail: registo de envios e estado de notificação dos pagamentos.
--
-- Antes, os e-mails de subscrição falhavam em silêncio (só ficavam nos logs da
-- função). Esta migração cria public.email_log, onde as funções edge registam
-- cada envio ('sent', 'failed' ou 'skipped' quando o SMTP não está configurado),
-- e acrescenta a subscription_payments as colunas que tornam o envio idempotente
-- (a Sislog repete o webhook até 5 vezes) e permitem reenviar a partir do admin.

-- ---------------------------------------------------------------------------
-- email_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  related_table text,
  related_id text,
  recipients text[] NOT NULL DEFAULT '{}',
  subject text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  message_id text
);

CREATE INDEX IF NOT EXISTS idx_email_log_created_at ON public.email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_related ON public.email_log (related_table, related_id);
CREATE INDEX IF NOT EXISTS idx_email_log_company ON public.email_log (company_id);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Só administradores da plataforma lêem. Não há política de escrita: apenas a
-- service role (funções edge) insere, e essa ignora RLS.
DROP POLICY IF EXISTS "Admins can view email log" ON public.email_log;
CREATE POLICY "Admins can view email log"
  ON public.email_log FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.email_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- subscription_payments: estado das notificações
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS payer_email text,
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notification_error text;

COMMENT ON COLUMN public.subscription_payments.payer_email IS
  'E-mail do utilizador que iniciou o pagamento; recebe também a confirmação.';
COMMENT ON COLUMN public.subscription_payments.client_notified_at IS
  'Quando o e-mail de confirmação ao cliente foi enviado com sucesso.';
COMMENT ON COLUMN public.subscription_payments.admin_notified_at IS
  'Quando a notificação interna (LTS) foi enviada com sucesso.';
COMMENT ON COLUMN public.subscription_payments.notification_error IS
  'Último erro de envio de notificações, se algum.';
