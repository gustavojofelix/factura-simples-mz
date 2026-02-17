-- Migration: Add status to companies table for independent management
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial'));

COMMENT ON COLUMN public.companies.status IS 'Estado individual da empresa/contribuinte';
