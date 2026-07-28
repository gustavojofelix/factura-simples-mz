-- Migration: Create subscription_payments table for Sislog (M-Pesa / e-Mola) payments

CREATE TABLE IF NOT EXISTS subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Standard',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount decimal(10,2) NOT NULL DEFAULT 7500.00,
  currency text DEFAULT 'MZN',
  payment_method text NOT NULL CHECK (payment_method IN ('mpesa', 'emola')),
  phone_number text NOT NULL,
  reference_code text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  sislog_response jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- Policies for subscription_payments
DO $$ BEGIN
  CREATE POLICY "Users can view subscription payments of their companies"
    ON subscription_payments FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM company_users
        WHERE company_users.company_id = subscription_payments.company_id
        AND company_users.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert subscription payments for their companies"
    ON subscription_payments FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM company_users
        WHERE company_users.company_id = subscription_payments.company_id
        AND company_users.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes for fast query performance
CREATE INDEX IF NOT EXISTS idx_sub_payments_company ON subscription_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_sub ON subscription_payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_ref ON subscription_payments(reference_code);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_sub_payments_updated_at ON subscription_payments;
CREATE TRIGGER update_sub_payments_updated_at
  BEFORE UPDATE ON subscription_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
