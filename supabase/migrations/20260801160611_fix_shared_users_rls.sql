-- Fix RLS Policies to support shared users (company_users) without infinite recursion

-- 1. Create a secure function to check if a user is a member of a company
-- SECURITY DEFINER makes it run with the privileges of the creator, bypassing RLS
CREATE OR REPLACE FUNCTION public.is_company_member(check_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = check_company_id
    AND cu.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update companies RLS
DROP POLICY IF EXISTS "Users can view their companies" ON companies;
CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR public.is_company_member(id)
  );

-- 3. Update company_users RLS
DROP POLICY IF EXISTS "Users can view company_users of their companies" ON company_users;
CREATE POLICY "Users can view company_users of their companies"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR public.is_company_member(company_id)
  );

-- 4. Update invoices RLS
DROP POLICY IF EXISTS "Users can view invoices of their companies" ON invoices;
CREATE POLICY "Users can view invoices of their companies"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id)
  );

-- 5. Update products RLS
DROP POLICY IF EXISTS "Users can view products of their companies" ON products;
CREATE POLICY "Users can view products of their companies"
  ON products FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id)
  );

-- 6. Update clients RLS
DROP POLICY IF EXISTS "Users can view clients of their companies" ON clients;
CREATE POLICY "Users can view clients of their companies"
  ON clients FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id)
  );

-- 7. Update system_settings RLS
DROP POLICY IF EXISTS "Users can view settings of their companies" ON system_settings;
CREATE POLICY "Users can view settings of their companies"
  ON system_settings FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id)
  );

-- 8. Update subscriptions RLS
DROP POLICY IF EXISTS "Users can view subscriptions of their companies" ON subscriptions;
CREATE POLICY "Users can view subscriptions of their companies"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id)
  );
