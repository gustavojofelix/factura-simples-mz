-- Migration: Create subscription_plans table and seed initial plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  monthly_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  yearly_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'MZN',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Policy for reading: Active plans visible to everyone (anon & authenticated),
-- Admins can view all plans
DROP POLICY IF EXISTS "Anyone can view active subscription plans" ON public.subscription_plans;
CREATE POLICY "Anyone can view active subscription plans"
ON public.subscription_plans
FOR SELECT
USING (
  is_active = true OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Policy for admin mutations (INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "Super admins can manage subscription plans" ON public.subscription_plans;
CREATE POLICY "Super admins can manage subscription plans"
ON public.subscription_plans
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Seed initial plans
INSERT INTO public.subscription_plans (code, name, description, monthly_price, yearly_price, currency, features, is_active, is_popular, sort_order)
VALUES
  (
    'trial',
    'Trial',
    'Período de teste de 14 dias',
    0.00,
    0.00,
    'MZN',
    '["Acesso completo durante 14 dias", "Faturação ilimitada no período", "Gestão de clientes e produtos", "Cálculo automático de ISPC"]'::jsonb,
    true,
    false,
    1
  ),
  (
    'essencial',
    'Essencial',
    'Ideal para autónomos e microempresas',
    2500.00,
    25000.00,
    'MZN',
    '["Até 100 facturas/mês", "Clientes ilimitados", "Cálculo automático de ISPC", "Envio por email", "1 empresa", "Suporte por email"]'::jsonb,
    true,
    false,
    2
  ),
  (
    'profissional',
    'Profissional',
    'Para empresas em crescimento que precisam de mais recursos',
    7500.00,
    75000.00,
    'MZN',
    '["Facturação ilimitada", "Utilizadores ilimitados", "Suporte prioritário 24/7", "Relatórios e modelos fiscais", "Backup automático", "Múltiplas empresas"]'::jsonb,
    true,
    true,
    3
  ),
  (
    'standard',
    'Standard',
    'Plano completo e ilimitado para a sua empresa',
    7500.00,
    75000.00,
    'MZN',
    '["Faturação e recibos ilimitados", "Utilizadores e acessos ilimitados", "Suporte prioritário 24/7", "Modelos fiscais e relatórios completos", "Backup automático na nuvem", "Conformidade legal e fiscal total (AT / MZN)"]'::jsonb,
    true,
    false,
    4
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_price = EXCLUDED.monthly_price,
  yearly_price = EXCLUDED.yearly_price,
  features = EXCLUDED.features,
  updated_at = now();
