-- Migration: Add 3 months and 6 months pricing columns to subscription_plans
ALTER TABLE public.subscription_plans 
ADD COLUMN IF NOT EXISTS three_months_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS six_months_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

-- Update existing plans with initial 3-month and 6-month default prices if they are 0
UPDATE public.subscription_plans
SET 
  three_months_price = CASE WHEN monthly_price > 0 THEN monthly_price * 3 ELSE 0 END,
  six_months_price = CASE WHEN monthly_price > 0 THEN monthly_price * 6 ELSE 0 END
WHERE three_months_price = 0 AND six_months_price = 0;
