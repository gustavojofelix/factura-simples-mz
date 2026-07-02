-- Migration: Create audit_logs table with security policies and indices

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    entity_id TEXT,
    entity_name TEXT,
    ip_address TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Super Admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Company admins can view their company logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;

-- Super Admins can view all logs
CREATE POLICY "Super Admins can view all audit logs" ON public.audit_logs
    FOR SELECT USING (public.is_admin());

-- Company administrators/owners can view logs for their own companies
CREATE POLICY "Company admins can view their company logs" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = audit_logs.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
      )
    );

-- Any authenticated user can insert logs (append-only)
CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Create performance indices
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON public.audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(category);
