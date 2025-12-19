/*
  # Fix Security and Performance Issues - Final Comprehensive Migration

  ## Overview
  This migration addresses all identified security and performance issues across the database:

  ## 1. Missing Foreign Key Indexes
  - Add index on `invoice_items.product_id` - improves JOIN performance with products table
  - Add index on `payments.created_by` - improves queries filtering by creator

  ## 2. Remove Duplicate RLS Policies
  ### Subscriptions Table:
  - Remove "Company owners can manage subscriptions" (duplicate of "Owners can manage subscriptions")
  - Remove "Users can view their company subscriptions" (duplicate of "Users can view subscriptions of their companies")
  
  ### System Settings Table:
  - Remove "Company admins can manage system settings" (duplicate of "Owners can manage settings")
  - Remove "Users can view their company system settings" (duplicate of "Users can view settings of their companies")

  ## 3. Optimize ALL RLS Policies
  Replace all instances of `auth.uid()` with `(select auth.uid())` for performance optimization.
  This prevents the function from being called multiple times per row and improves query planning.
  
  Applied to ALL tables:
  - profiles
  - companies
  - company_users
  - clients
  - products
  - invoices
  - invoice_items
  - payments
  - tax_declarations
  - tax_payments
  - subscriptions
  - system_settings

  ## 4. Secure Function Search Paths
  Add `SECURITY DEFINER SET search_path = public, pg_temp` to prevent search_path attacks.
  
  Functions secured:
  - update_updated_at_column
  - update_invoice_payment_amounts
  - update_tax_updated_at
  - add_company_owner
  - create_company_owner

  ## Important Column Name Corrections Applied:
  - `profiles` table uses `id` (not `user_id`)
  - `tax_payments` table uses `tax_declaration_id` (not `declaration_id`)
*/

-- ============================================================================
-- SECTION 1: ADD MISSING FOREIGN KEY INDEXES
-- ============================================================================

-- Add index on invoice_items.product_id for improved JOIN performance
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items(product_id);

-- Add index on payments.created_by for improved filtering by creator
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments(created_by);

-- ============================================================================
-- SECTION 2: REMOVE DUPLICATE RLS POLICIES
-- ============================================================================

-- Remove duplicate policies from subscriptions table
DROP POLICY IF EXISTS "Company owners can manage subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users can view their company subscriptions" ON subscriptions;

-- Remove duplicate policies from system_settings table
DROP POLICY IF EXISTS "Company admins can manage system settings" ON system_settings;
DROP POLICY IF EXISTS "Users can view their company system settings" ON system_settings;

-- ============================================================================
-- SECTION 3: OPTIMIZE ALL RLS POLICIES - REPLACE auth.uid() WITH (select auth.uid())
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PROFILES TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- COMPANIES TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their companies" ON companies;
CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own companies" ON companies;
CREATE POLICY "Users can insert own companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners can update companies" ON companies;
CREATE POLICY "Owners can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners can delete companies" ON companies;
CREATE POLICY "Owners can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- COMPANY_USERS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "View own record or if company owner" ON company_users;
CREATE POLICY "View own record or if company owner"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Company owners can add users" ON company_users;
CREATE POLICY "Company owners can add users"
  ON company_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Company owners can update users" ON company_users;
CREATE POLICY "Company owners can update users"
  ON company_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Company owners can remove users" ON company_users;
CREATE POLICY "Company owners can remove users"
  ON company_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- CLIENTS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view clients of their companies" ON clients;
CREATE POLICY "Users can view clients of their companies"
  ON clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert clients for their companies" ON clients;
CREATE POLICY "Users can insert clients for their companies"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update clients of their companies" ON clients;
CREATE POLICY "Users can update clients of their companies"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete clients of their companies" ON clients;
CREATE POLICY "Users can delete clients of their companies"
  ON clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- PRODUCTS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view products of their companies" ON products;
CREATE POLICY "Users can view products of their companies"
  ON products FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert products for their companies" ON products;
CREATE POLICY "Users can insert products for their companies"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update products of their companies" ON products;
CREATE POLICY "Users can update products of their companies"
  ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete products of their companies" ON products;
CREATE POLICY "Users can delete products of their companies"
  ON products FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- INVOICES TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view invoices of their companies" ON invoices;
CREATE POLICY "Users can view invoices of their companies"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert invoices for their companies" ON invoices;
CREATE POLICY "Users can insert invoices for their companies"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update invoices of their companies" ON invoices;
CREATE POLICY "Users can update invoices of their companies"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete invoices of their companies" ON invoices;
CREATE POLICY "Users can delete invoices of their companies"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- INVOICE_ITEMS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can view invoice items of their companies"
  ON invoice_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert invoice items for their companies" ON invoice_items;
CREATE POLICY "Users can insert invoice items for their companies"
  ON invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can update invoice items of their companies"
  ON invoice_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can delete invoice items of their companies"
  ON invoice_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- PAYMENTS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view payments from their company" ON payments;
CREATE POLICY "Users can view payments from their company"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create payments for their company invoices" ON payments;
CREATE POLICY "Users can create payments for their company invoices"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete payments from their company" ON payments;
CREATE POLICY "Users can delete payments from their company"
  ON payments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = payments.invoice_id
      AND companies.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- TAX_DECLARATIONS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view tax declarations of their companies" ON tax_declarations;
CREATE POLICY "Users can view tax declarations of their companies"
  ON tax_declarations FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can create tax declarations for their companies" ON tax_declarations;
CREATE POLICY "Users can create tax declarations for their companies"
  ON tax_declarations FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update tax declarations of their companies" ON tax_declarations;
CREATE POLICY "Users can update tax declarations of their companies"
  ON tax_declarations FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete tax declarations of their companies" ON tax_declarations;
CREATE POLICY "Users can delete tax declarations of their companies"
  ON tax_declarations FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- TAX_PAYMENTS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view tax payments of their companies" ON tax_payments;
CREATE POLICY "Users can view tax payments of their companies"
  ON tax_payments FOR SELECT
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can create tax payments for their companies" ON tax_payments;
CREATE POLICY "Users can create tax payments for their companies"
  ON tax_payments FOR INSERT
  TO authenticated
  WITH CHECK (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can update tax payments of their companies" ON tax_payments;
CREATE POLICY "Users can update tax payments of their companies"
  ON tax_payments FOR UPDATE
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = (select auth.uid())
      )
    )
  )
  WITH CHECK (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete tax payments of their companies" ON tax_payments;
CREATE POLICY "Users can delete tax payments of their companies"
  ON tax_payments FOR DELETE
  TO authenticated
  USING (
    tax_declaration_id IN (
      SELECT id FROM tax_declarations
      WHERE company_id IN (
        SELECT id FROM companies
        WHERE user_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view subscriptions of their companies" ON subscriptions;
CREATE POLICY "Users can view subscriptions of their companies"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can manage subscriptions" ON subscriptions;
CREATE POLICY "Owners can manage subscriptions"
  ON subscriptions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- SYSTEM_SETTINGS TABLE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view settings of their companies" ON system_settings;
CREATE POLICY "Users can view settings of their companies"
  ON system_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can manage settings" ON system_settings;
CREATE POLICY "Owners can manage settings"
  ON system_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- SECTION 4: SECURE FUNCTION SEARCH PATHS
-- ============================================================================

-- Secure update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Secure update_invoice_payment_amounts function
CREATE OR REPLACE FUNCTION update_invoice_payment_amounts()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
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
$$;

-- Secure update_tax_updated_at function
CREATE OR REPLACE FUNCTION update_tax_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Secure add_company_owner function
CREATE OR REPLACE FUNCTION add_company_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO company_users (company_id, user_id, role, is_active)
  VALUES (NEW.id, NEW.user_id, 'owner', true)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  INSERT INTO system_settings (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;

  INSERT INTO subscriptions (company_id, plan_name, status)
  VALUES (NEW.id, 'Trial', 'trialing')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Secure create_company_owner function
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  -- Criar owner na tabela company_users
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');

  -- Criar subscription com trial de 14 dias
  INSERT INTO subscriptions (
    company_id, 
    plan_name, 
    status, 
    billing_cycle, 
    amount, 
    start_date, 
    end_date,
    next_billing_date
  )
  VALUES (
    NEW.id,
    'Trial',
    'trialing',
    'monthly',
    0,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '14 days'
  );

  -- Criar configurações do sistema
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

COMMENT ON SCHEMA public IS 
'Security and Performance Optimization Complete:
- Added 2 missing foreign key indexes
- Removed 4 duplicate RLS policies
- Optimized all RLS policies with (select auth.uid())
- Secured 5 functions with search_path protection';
