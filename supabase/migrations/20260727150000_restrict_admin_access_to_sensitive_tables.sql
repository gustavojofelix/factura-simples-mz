-- Migration: Revogar acesso admin (Back Office / LTS) a tabelas sensíveis dos utilizadores finais
-- As tabelas abaixo contêm dados de negócio privados dos contribuintes (vendas, clientes, produtos).
-- A equipa LTS no Back Office não deve ter visibilidade sobre estes dados.

-- CLIENTS (clientes dos contribuintes)
DROP POLICY IF EXISTS "Admins can do everything on clients" ON public.clients;

-- PRODUCTS (produtos e serviços dos contribuintes)
DROP POLICY IF EXISTS "Admins can do everything on products" ON public.products;

-- INVOICES (facturas dos contribuintes)
DROP POLICY IF EXISTS "Admins can do everything on invoices" ON public.invoices;

-- INVOICE_ITEMS (itens de factura)
DROP POLICY IF EXISTS "Admins can do everything on invoice_items" ON public.invoice_items;

-- PAYMENTS (pagamentos de facturas)
DROP POLICY IF EXISTS "Admins can do everything on payments" ON public.payments;

-- TAX_DECLARATIONS (declarações fiscais)
DROP POLICY IF EXISTS "Admins can do everything on tax_declarations" ON public.tax_declarations;

-- TAX_PAYMENTS (pagamentos de impostos)
DROP POLICY IF EXISTS "Admins can do everything on tax_payments" ON public.tax_payments;
