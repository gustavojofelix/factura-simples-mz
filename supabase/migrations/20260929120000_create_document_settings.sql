-- Migration: Criar as definições de personalização de documentos por empresa
-- Descrição: Modelo visual, cores, textos por omissão, número de vias e o texto
-- das mensagens de e-mail enviadas ao cliente. Uma linha por empresa.
--
-- Os valores por omissão reproduzem o aspecto actual dos documentos. Os campos
-- de texto novos nascem vazios de propósito, para que nenhuma empresa veja
-- conteúdo aparecer nas suas facturas sem o ter pedido.

CREATE TABLE IF NOT EXISTS public.document_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Modelo e marca
  template_code text NOT NULL DEFAULT 'classico'
    CHECK (template_code IN ('classico', 'moderno', 'minimalista')),
  primary_color text NOT NULL DEFAULT '#f16c39'
    CHECK (primary_color ~* '^#[0-9a-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#332d2a'
    CHECK (accent_color ~* '^#[0-9a-f]{6}$'),
  show_logo boolean NOT NULL DEFAULT true,
  show_bank_details boolean NOT NULL DEFAULT true,

  -- Textos dos documentos
  thank_you_message text NOT NULL DEFAULT ''
    CHECK (char_length(thank_you_message) <= 160),
  default_observations text NOT NULL DEFAULT ''
    CHECK (char_length(default_observations) <= 500),
  footer_text text NOT NULL DEFAULT ''
    CHECK (char_length(footer_text) <= 240),

  -- Vias impressas
  invoice_copies smallint NOT NULL DEFAULT 1 CHECK (invoice_copies BETWEEN 1 AND 3),
  receipt_copies smallint NOT NULL DEFAULT 1 CHECK (receipt_copies BETWEEN 1 AND 3),

  -- Mensagem de e-mail da factura
  email_subject text NOT NULL DEFAULT 'Factura {{numero_factura}} - {{empresa}}'
    CHECK (char_length(email_subject) <= 200),
  email_greeting text NOT NULL DEFAULT 'Olá {{cliente}},'
    CHECK (char_length(email_greeting) <= 200),
  email_body text NOT NULL DEFAULT 'Confirmamos a emissão do documento {{numero_factura}}. Segue em anexo a sua factura em formato PDF com todos os detalhes de facturação.'
    CHECK (char_length(email_body) <= 2000),
  email_signature text NOT NULL DEFAULT 'Com os melhores cumprimentos,'
    CHECK (char_length(email_signature) <= 200),

  -- Mensagem de e-mail do recibo
  receipt_email_subject text NOT NULL DEFAULT 'Recibo de pagamento - {{empresa}}'
    CHECK (char_length(receipt_email_subject) <= 200),
  receipt_email_body text NOT NULL DEFAULT 'Confirmamos a recepção do pagamento de {{valor_pago}} referente à factura {{numero_factura}}. Segue o recibo em anexo.'
    CHECK (char_length(receipt_email_body) <= 2000),

  -- Encaminhamento das respostas
  email_reply_to text
    CHECK (email_reply_to IS NULL OR email_reply_to ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- Espaço para crescimento futuro sem nova migração
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_settings_company_unique UNIQUE (company_id)
);

COMMENT ON TABLE public.document_settings IS 'Personalização de facturas, recibos e e-mails, por empresa.';
COMMENT ON COLUMN public.document_settings.template_code IS 'Modelo visual do documento: classico, moderno ou minimalista.';
COMMENT ON COLUMN public.document_settings.primary_color IS 'Cor principal da marca, em hexadecimal. O valor por omissão é o laranja usado hoje nas facturas.';
COMMENT ON COLUMN public.document_settings.default_observations IS 'Texto que pré-preenche as notas ao criar uma factura. Nunca é usado como texto de recurso ao desenhar documentos já emitidos.';
COMMENT ON COLUMN public.document_settings.invoice_copies IS 'Quantas vias etiquetadas o PDF produz numa emissão. Não se confunde com o contador de reimpressões.';

-- A leitura tem de estar aberta a qualquer membro da empresa, porque quem emite
-- facturas no dia a dia costuma ter um papel inferior e precisa de ver o
-- documento com a marca aplicada. Só a escrita fica reservada.
ALTER TABLE public.document_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view document settings" ON public.document_settings;
CREATE POLICY "Members can view document settings"
  ON public.document_settings FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id) OR public.is_admin());

DROP POLICY IF EXISTS "Owners can insert document settings" ON public.document_settings;
CREATE POLICY "Owners can insert document settings"
  ON public.document_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = document_settings.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Owners can update document settings" ON public.document_settings;
CREATE POLICY "Owners can update document settings"
  ON public.document_settings FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = document_settings.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = document_settings.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Owners can delete document settings" ON public.document_settings;
CREATE POLICY "Owners can delete document settings"
  ON public.document_settings FOR DELETE
  TO authenticated
  USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = document_settings.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
  );

DROP TRIGGER IF EXISTS document_settings_updated_at ON public.document_settings;
CREATE TRIGGER document_settings_updated_at
  BEFORE UPDATE ON public.document_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- O gatilho de criação de empresa já provisiona company_users, subscriptions e
-- system_settings. Passa a provisionar também as definições de documento.
-- O corpo abaixo reproduz a versão de 20260827122000 com essa única adição.
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  -- Criar owner na tabela company_users
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');

  -- Criar subscription com trial de 14 dias
  INSERT INTO subscriptions (
    company_id,
    plan_name,
    status,
    billing_cycle,
    amount,
    start_date,
    end_date,
    next_billing_date,
    plan_id
  )
  VALUES (
    NEW.id,
    'Trial',
    'trialing',
    'monthly',
    0,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '14 days',
    (SELECT id FROM public.subscription_plans WHERE code = 'trial' LIMIT 1)
  );

  -- Criar configurações do sistema
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);

  -- Criar configurações de personalização de documentos
  INSERT INTO public.document_settings (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Preenchimento retroactivo das empresas já existentes.
INSERT INTO public.document_settings (company_id)
SELECT c.id FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;
