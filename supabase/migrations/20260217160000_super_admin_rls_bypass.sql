-- Migration: Unlock global access for Super-Admins (RLS Bypass)

-- 1. Create a security definer function to check admin status without recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Add Super-Admin policies to all relevant tables
-- Note: PostgreSQL policies are additive, so these will act as an OR with existing ones.

-- PROFILES
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on profiles" ON public.profiles
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- COMPANIES
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on companies" ON public.companies
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SUBSCRIPTIONS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on subscriptions" ON public.subscriptions
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- COMPANY_USERS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on company_users" ON public.company_users
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INVOICES
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on invoices" ON public.invoices
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INVOICE_ITEMS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on invoice_items" ON public.invoice_items
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CLIENTS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on clients" ON public.clients
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PRODUCTS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on products" ON public.products
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PAYMENTS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on payments" ON public.payments
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TAX_DECLARATIONS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on tax_declarations" ON public.tax_declarations
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TAX_PAYMENTS
DO $$ BEGIN
  CREATE POLICY "Admins can do everything on tax_payments" ON public.tax_payments
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
