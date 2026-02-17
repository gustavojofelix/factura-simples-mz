-- Migration: Expand administrative schema for ISPC Fácil

-- 1. Profiles: Add status column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text DEFAULT 'trial' CHECK (status IN ('active', 'suspended', 'trial'));

-- 2. Subscriptions: Update billing cycles and add grace period
-- First, drop the old constraint if it exists
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS valid_billing_cycle;
-- Add updated constraint
ALTER TABLE public.subscriptions ADD CONSTRAINT valid_billing_cycle CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'yearly'));
-- Add grace_period_until
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS grace_period_until date;

-- 3. Companies: Add geographic and payment fields
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS nib text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS mpesa_number text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS emola_number text;

-- 4. Update existing subscriptions to have grace_period_until as null
-- (Already handled by ADD COLUMN IF NOT EXISTS)

-- 5. Comments for clarity
COMMENT ON COLUMN public.profiles.status IS 'Status do utilizador na plataforma';
COMMENT ON COLUMN public.subscriptions.grace_period_until IS 'Data limite do período de carência (grace period)';
COMMENT ON COLUMN public.companies.nib IS 'Número de Identificação Bancária da empresa';
COMMENT ON COLUMN public.companies.mpesa_number IS 'Número M-Pesa para recebimento';
COMMENT ON COLUMN public.companies.emola_number IS 'Número E-Mola para recebimento';
