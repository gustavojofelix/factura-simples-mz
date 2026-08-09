-- Migration: Create vouchers and voucher_redemptions tables
CREATE TABLE IF NOT EXISTS public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage', -- 'percentage', 'fixed_amount', 'trial_days'
  discount_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
  scope VARCHAR(20) NOT NULL DEFAULT 'global', -- 'global', 'specific_company', 'specific_user'
  target_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  target_user_email VARCHAR(255),
  max_uses INT DEFAULT NULL,
  uses_count INT NOT NULL DEFAULT 0,
  min_amount NUMERIC(10, 2) DEFAULT 0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voucher_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  discount_applied NUMERIC(10, 2) NOT NULL DEFAULT 0,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view active vouchers for code validation
DROP POLICY IF EXISTS "Authenticated users can view active vouchers" ON public.vouchers;
CREATE POLICY "Authenticated users can view active vouchers"
ON public.vouchers
FOR SELECT
TO authenticated
USING (is_active = true);

-- Allow admins full access to vouchers
DROP POLICY IF EXISTS "Admins full management of vouchers" ON public.vouchers;
CREATE POLICY "Admins full management of vouchers"
ON public.vouchers
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

-- Allow admins full access to redemptions
DROP POLICY IF EXISTS "Admins manage voucher redemptions" ON public.voucher_redemptions;
CREATE POLICY "Admins manage voucher redemptions"
ON public.voucher_redemptions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Allow users to insert their own redemptions
DROP POLICY IF EXISTS "Users can insert redemptions" ON public.voucher_redemptions;
CREATE POLICY "Users can insert redemptions"
ON public.voucher_redemptions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Seed initial demonstration vouchers
INSERT INTO public.vouchers (code, description, discount_type, discount_value, scope, max_uses, is_active)
VALUES
  ('BEMVINDO20', 'Desconto de boas-vindas de 20% para novos clientes', 'percentage', 20.00, 'global', 100, true),
  ('ISPC500MZN', 'Desconto fixo de 500 MZN em qualquer plano anual', 'fixed_amount', 500.00, 'global', 50, true),
  ('VIP30DIAS', '30 Dias grátis adicionais para clientes selecionados', 'trial_days', 30.00, 'global', NULL, true)
ON CONFLICT (code) DO NOTHING;
