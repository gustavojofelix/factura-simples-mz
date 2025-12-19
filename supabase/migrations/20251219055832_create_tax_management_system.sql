/*
  # Sistema de Gestão de Impostos
  
  Cria tabelas e funcionalidades para gestão completa de impostos (ISPC).
  
  1. Nova Tabela: `tax_declarations`
    - `id` (uuid, chave primária)
    - `company_id` (uuid, referência a companies)
    - `period` (integer): período/trimestre (1, 2, 3, 4)
    - `year` (integer): ano da declaração
    - `start_date` (date): data início do período
    - `end_date` (date): data fim do período
    - `total_sales` (numeric): total de vendas no período
    - `ispc_base` (numeric): base tributável do ISPC
    - `ispc_rate` (numeric): taxa de ISPC aplicada
    - `ispc_amount` (numeric): montante de ISPC a pagar
    - `status` (text): pendente, submetida, paga, atrasada
    - `submission_date` (date): data de submissão à AT
    - `due_date` (date): data limite de pagamento
    - `payment_date` (date): data de pagamento efetivo
    - `model_30_data` (jsonb): dados estruturados do modelo 30
    - `notes` (text): observações
    - `created_at`, `updated_at`
    
  2. Nova Tabela: `tax_payments`
    - `id` (uuid, chave primária)
    - `tax_declaration_id` (uuid, referência a tax_declarations)
    - `amount` (numeric): valor pago
    - `payment_date` (date): data do pagamento
    - `payment_method` (text): método de pagamento
    - `reference` (text): referência do pagamento
    - `receipt_url` (text): URL do comprovativo
    - `notes` (text): observações
    - `created_at`, `updated_at`
    
  3. Segurança
    - RLS habilitado em ambas as tabelas
    - Políticas para autenticados poderem gerir suas declarações
    - Políticas baseadas em company_id
*/

-- Criar tabela de declarações de impostos
CREATE TABLE IF NOT EXISTS tax_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period integer NOT NULL CHECK (period >= 1 AND period <= 4),
  year integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  ispc_base numeric(12,2) NOT NULL DEFAULT 0,
  ispc_rate numeric(5,2) NOT NULL DEFAULT 5.00,
  ispc_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  submission_date date,
  due_date date,
  payment_date date,
  model_30_data jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('pendente', 'submetida', 'paga', 'atrasada')),
  CONSTRAINT unique_declaration UNIQUE (company_id, period, year)
);

-- Criar tabela de pagamentos de impostos
CREATE TABLE IF NOT EXISTS tax_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_declaration_id uuid NOT NULL REFERENCES tax_declarations(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,
  reference text,
  receipt_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_payments ENABLE ROW LEVEL SECURITY;

-- Políticas para tax_declarations
CREATE POLICY "Users can view tax declarations of their companies"
  ON tax_declarations FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tax declarations for their companies"
  ON tax_declarations FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tax declarations of their companies"
  ON tax_declarations FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tax declarations of their companies"
  ON tax_declarations FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

-- Políticas para tax_payments
CREATE POLICY "Users can view tax payments of their companies"
  ON tax_payments FOR SELECT
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create tax payments for their companies"
  ON tax_payments FOR INSERT
  TO authenticated
  WITH CHECK (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update tax payments of their companies"
  ON tax_payments FOR UPDATE
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete tax payments of their companies"
  ON tax_payments FOR DELETE
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = auth.uid()
      )
    )
  );

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_tax_declarations_company ON tax_declarations(company_id);
CREATE INDEX IF NOT EXISTS idx_tax_declarations_period ON tax_declarations(year, period);
CREATE INDEX IF NOT EXISTS idx_tax_declarations_status ON tax_declarations(status);
CREATE INDEX IF NOT EXISTS idx_tax_payments_declaration ON tax_payments(tax_declaration_id);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_tax_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para atualizar updated_at
DROP TRIGGER IF EXISTS tax_declarations_updated_at ON tax_declarations;
CREATE TRIGGER tax_declarations_updated_at
  BEFORE UPDATE ON tax_declarations
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_updated_at();

DROP TRIGGER IF EXISTS tax_payments_updated_at ON tax_payments;
CREATE TRIGGER tax_payments_updated_at
  BEFORE UPDATE ON tax_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_updated_at();