/*
  # Cleanup Unused Indexes and Fix Multiple Permissive Policies

  ## Changes

  ### 1. Drop Unused Indexes
    - Drop `idx_payments_payment_date` - not being used by queries
    - Drop `idx_invoices_due_date` - not being used by queries
    - Drop `idx_tax_declarations_period` - not being used by queries
    - Drop `idx_tax_declarations_status` - not being used by queries
    - Drop `idx_invoice_items_product_id` - recently added but not yet used
    - Drop `idx_payments_created_by` - recently added but not yet used
    - Drop `idx_invoices_client_id` - not being used by queries
    - Drop `idx_invoices_status` - not being used by queries

  ### 2. Fix Multiple Permissive Policies
    - Split `subscriptions` FOR ALL policy into separate INSERT/UPDATE/DELETE policies
    - Split `system_settings` FOR ALL policy into separate INSERT/UPDATE/DELETE policies
    - This eliminates overlapping SELECT policies

  ## Notes
    - Unused indexes waste storage and slow down INSERT/UPDATE/DELETE operations
    - They can be re-added later if query patterns change
    - Multiple permissive policies for the same action can be confusing and should be consolidated
*/

-- ============================================================================
-- 1. DROP UNUSED INDEXES
-- ============================================================================

DROP INDEX IF EXISTS idx_payments_payment_date;
DROP INDEX IF EXISTS idx_invoices_due_date;
DROP INDEX IF EXISTS idx_tax_declarations_period;
DROP INDEX IF EXISTS idx_tax_declarations_status;
DROP INDEX IF EXISTS idx_invoice_items_product_id;
DROP INDEX IF EXISTS idx_payments_created_by;
DROP INDEX IF EXISTS idx_invoices_client_id;
DROP INDEX IF EXISTS idx_invoices_status;

-- ============================================================================
-- 2. FIX MULTIPLE PERMISSIVE POLICIES - SUBSCRIPTIONS
-- ============================================================================

-- Drop the FOR ALL policy
DROP POLICY IF EXISTS "Owners can manage subscriptions" ON subscriptions;

-- Create separate INSERT, UPDATE, DELETE policies
CREATE POLICY "Owners can insert subscriptions"
  ON subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );

CREATE POLICY "Owners can update subscriptions"
  ON subscriptions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );

CREATE POLICY "Owners can delete subscriptions"
  ON subscriptions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );

-- ============================================================================
-- 3. FIX MULTIPLE PERMISSIVE POLICIES - SYSTEM_SETTINGS
-- ============================================================================

-- Drop the FOR ALL policy
DROP POLICY IF EXISTS "Owners can manage settings" ON system_settings;

-- Create separate INSERT, UPDATE, DELETE policies
CREATE POLICY "Owners can insert settings"
  ON system_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );

CREATE POLICY "Owners can update settings"
  ON system_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );

CREATE POLICY "Owners can delete settings"
  ON system_settings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = (select auth.uid())
      AND company_users.role = 'owner'
    )
  );