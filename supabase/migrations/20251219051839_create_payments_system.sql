/*
  # Sistema de Pagamentos para Facturas

  1. Nova Tabela: `payments`
    - `id` (uuid, primary key)
    - `invoice_id` (uuid, foreign key): referência à factura
    - `amount` (numeric): valor do pagamento
    - `payment_date` (date): data do pagamento
    - `payment_method` (text): método de pagamento (dinheiro, transferência, etc.)
    - `reference` (text, opcional): referência do pagamento
    - `notes` (text, opcional): observações
    - `created_at` (timestamp): data de criação
    - `created_by` (uuid): utilizador que registou o pagamento

  2. Alterações na tabela `invoices`
    - Adicionar `amount_paid` (numeric): total pago
    - Adicionar `amount_pending` (numeric): valor pendente
    - Remover controlo manual de status (será automático)

  3. Segurança
    - Enable RLS em `payments`
    - Políticas para criar, ler e eliminar pagamentos
    - Facturas pagas não podem ser alteradas

  4. Lógica de Status (será implementada na aplicação)
    - "pago": amount_paid >= total
    - "vencido": due_date < hoje AND amount_paid < total
    - "pendente": todos os outros casos
*/

-- Criar tabela de pagamentos
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'dinheiro',
  reference text,
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Adicionar campos de pagamento à tabela de facturas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'amount_paid'
  ) THEN
    ALTER TABLE invoices ADD COLUMN amount_paid numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'amount_pending'
  ) THEN
    ALTER TABLE invoices ADD COLUMN amount_pending numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

-- Enable RLS na tabela de pagamentos
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Políticas de segurança para pagamentos
CREATE POLICY "Users can view payments from their company"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create payments for their company invoices"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete payments from their company"
  ON payments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

-- Função para actualizar valores de pagamento na factura
CREATE OR REPLACE FUNCTION update_invoice_payment_amounts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE invoices
  SET 
    amount_paid = COALESCE((
      SELECT SUM(amount)
      FROM payments
      WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    ), 0),
    amount_pending = total - COALESCE((
      SELECT SUM(amount)
      FROM payments
      WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    ), 0)
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar automaticamente os valores
DROP TRIGGER IF EXISTS update_invoice_amounts_on_payment_insert ON payments;
CREATE TRIGGER update_invoice_amounts_on_payment_insert
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_payment_amounts();

DROP TRIGGER IF EXISTS update_invoice_amounts_on_payment_delete ON payments;
CREATE TRIGGER update_invoice_amounts_on_payment_delete
  AFTER DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_payment_amounts();

-- Atualizar valores pendentes para facturas existentes
UPDATE invoices
SET 
  amount_paid = 0,
  amount_pending = total
WHERE amount_pending = 0;
