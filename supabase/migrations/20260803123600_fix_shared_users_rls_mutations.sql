-- Fix RLS Policies for mutations (INSERT, UPDATE, DELETE) to support shared users (company_users)

-- Update invoices RLS
DROP POLICY IF EXISTS "Users can insert invoices for their companies" ON invoices;
CREATE POLICY "Users can insert invoices for their companies"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can update invoices of their companies" ON invoices;
CREATE POLICY "Users can update invoices of their companies"
  ON invoices FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can delete invoices of their companies" ON invoices;
CREATE POLICY "Users can delete invoices of their companies"
  ON invoices FOR DELETE
  TO authenticated
  USING (public.is_company_member(company_id));

-- Update invoice_items RLS
DROP POLICY IF EXISTS "Users can view invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can view invoice items of their companies"
  ON invoice_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

DROP POLICY IF EXISTS "Users can insert invoice items for their companies" ON invoice_items;
CREATE POLICY "Users can insert invoice items for their companies"
  ON invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

DROP POLICY IF EXISTS "Users can update invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can update invoice items of their companies"
  ON invoice_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

DROP POLICY IF EXISTS "Users can delete invoice items of their companies" ON invoice_items;
CREATE POLICY "Users can delete invoice items of their companies"
  ON invoice_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

-- Update products RLS
DROP POLICY IF EXISTS "Users can insert products for their companies" ON products;
CREATE POLICY "Users can insert products for their companies"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can update products of their companies" ON products;
CREATE POLICY "Users can update products of their companies"
  ON products FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can delete products of their companies" ON products;
CREATE POLICY "Users can delete products of their companies"
  ON products FOR DELETE
  TO authenticated
  USING (public.is_company_member(company_id));

-- Update clients RLS
DROP POLICY IF EXISTS "Users can insert clients for their companies" ON clients;
CREATE POLICY "Users can insert clients for their companies"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can update clients of their companies" ON clients;
CREATE POLICY "Users can update clients of their companies"
  ON clients FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Users can delete clients of their companies" ON clients;
CREATE POLICY "Users can delete clients of their companies"
  ON clients FOR DELETE
  TO authenticated
  USING (public.is_company_member(company_id));

-- Update payments RLS
DROP POLICY IF EXISTS "Users can view payments from their company" ON payments;
CREATE POLICY "Users can view payments from their company"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = payments.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

DROP POLICY IF EXISTS "Users can create payments for their company invoices" ON payments;
CREATE POLICY "Users can create payments for their company invoices"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = payments.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );

DROP POLICY IF EXISTS "Users can delete payments from their company" ON payments;
CREATE POLICY "Users can delete payments from their company"
  ON payments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = payments.invoice_id
      AND public.is_company_member(invoices.company_id)
    )
  );
