-- Back office: atribuir planos de subscrição aos contribuintes e personalizar
-- o texto da página de Subscrição do front office.
--
-- 1. Atribuição pelo back office
--    O admin atribui um plano a uma empresa (pagamento por transferência,
--    numerário, carteira móvel recebida fora da plataforma, ou oferta). É
--    registado como um pagamento em subscription_payments, como os da Sislog,
--    para reaproveitar todo o fluxo existente: período na fila
--    (enqueue_subscription_period), factura no OfficeGest (sync-officegest) e
--    e-mail ao cliente com a factura em anexo (subscription-notify).
--    - payment_method passa a aceitar 'transfer', 'cash' e 'offer'
--      (oferta = 0 MZN, sem factura);
--    - phone_number deixa de ser obrigatório (só existe na carteira móvel).
--
-- 2. Texto da página de Subscrição
--    platform_settings.subscription_page_text guarda, por língua, o título, a
--    introdução e um aviso mostrados no separador Subscrição das Configurações.
--    Campos vazios usam o texto por omissão da aplicação.

-- ---------------------------------------------------------------------------
-- 1. subscription_payments: novos métodos de pagamento
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.subscription_payments'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%payment_method%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscription_payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_payment_method_check
  CHECK (payment_method IN ('mpesa', 'emola', 'transfer', 'cash', 'offer'));

ALTER TABLE public.subscription_payments
  ALTER COLUMN phone_number DROP NOT NULL;

-- O back office marca o pagamento como concluído (confirmação manual e
-- atribuição de plano). Sem política de UPDATE o RLS ignorava a escrita em
-- silêncio (0 linhas), e o pagamento ficava 'pending'.
DROP POLICY IF EXISTS "Admins can update subscription payments" ON public.subscription_payments;
CREATE POLICY "Admins can update subscription payments"
  ON public.subscription_payments FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON COLUMN public.subscription_payments.payment_method IS
  'mpesa / emola (Sislog ou recebido fora da plataforma); transfer = transferência bancária; cash = numerário; offer = oferta (0 MZN, sem factura).';

-- ---------------------------------------------------------------------------
-- 2. Texto da página de Subscrição (front office)
-- ---------------------------------------------------------------------------
-- Formato: { "pt-MZ": { "title": "", "intro": "", "notice": "" }, "en-GB": {...}, "fr-FR": {...} }
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'subscription_page_text',
  '{}'::jsonb,
  'Textos personalizados da página de Subscrição do front office (título, introdução e aviso), por língua.'
)
ON CONFLICT (key) DO NOTHING;
