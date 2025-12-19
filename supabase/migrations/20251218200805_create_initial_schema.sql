/*
  # Esquema Inicial do FaturaSimples MZ
  
  1. Novas Tabelas
    - `profiles`
      - `id` (uuid, chave primária, referência a auth.users)
      - `full_name` (text)
      - `phone` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `companies`
      - `id` (uuid, chave primária)
      - `user_id` (uuid, referência a auth.users)
      - `name` (text, nome da empresa)
      - `nuit` (text, NUIT - Número Único de Identificação Tributária)
      - `address` (text)
      - `business_type` (text, tipo de actividade)
      - `currency` (text, padrão: MZN)
      - `invoice_prefix` (text, prefixo para numeração de facturas)
      - `invoice_number` (integer, número sequencial)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `clients`
      - `id` (uuid, chave primária)
      - `company_id` (uuid, referência a companies)
      - `name` (text, nome do cliente)
      - `nuit` (text, NUIT do cliente)
      - `phone` (text)
      - `email` (text)
      - `address` (text)
      - `notes` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `products`
      - `id` (uuid, chave primária)
      - `company_id` (uuid, referência a companies)
      - `name` (text, nome do produto)
      - `description` (text)
      - `price` (decimal, preço unitário)
      - `ispc_category` (text, categoria ISPC)
      - `ispc_rate` (decimal, taxa ISPC em percentagem)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `invoices`
      - `id` (uuid, chave primária)
      - `company_id` (uuid, referência a companies)
      - `client_id` (uuid, referência a clients)
      - `invoice_number` (text, número da factura)
      - `date` (date, data de emissão)
      - `due_date` (date, data de vencimento)
      - `subtotal` (decimal, subtotal antes de impostos)
      - `ispc_amount` (decimal, valor total de ISPC)
      - `total` (decimal, valor total)
      - `status` (text, estado: pendente, paga, vencida)
      - `payment_date` (date, data de pagamento)
      - `payment_method` (text, método de pagamento)
      - `notes` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `invoice_items`
      - `id` (uuid, chave primária)
      - `invoice_id` (uuid, referência a invoices)
      - `product_id` (uuid, referência a products, opcional)
      - `description` (text, descrição do item)
      - `quantity` (decimal, quantidade)
      - `unit_price` (decimal, preço unitário)
      - `ispc_rate` (decimal, taxa ISPC)
      - `ispc_amount` (decimal, valor ISPC)
      - `total` (decimal, total do item)
      - `created_at` (timestamp)
  
  2. Segurança
    - Activar RLS em todas as tabelas
    - Políticas para utilizadores autenticados acederem apenas aos seus dados
    - Políticas baseadas em company_id para dados específicos de empresas
  
  3. Notas Importantes
    - NUIT: formato moçambicano de 9 dígitos + dígito de controlo
    - ISPC: imposto específico de Moçambique
    - Moeda padrão: MZN (Metical moçambicano)
    - Formato de números: 1.000,00 (separador de milhares: ponto, decimal: vírgula)
*/

-- Tabela de perfis de utilizadores
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Tabela de empresas
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  nuit text NOT NULL,
  address text,
  business_type text,
  currency text DEFAULT 'MZN',
  invoice_prefix text DEFAULT 'FAC',
  invoice_number integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own companies"
  ON companies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
  ON companies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Tabela de clientes
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  nuit text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view clients of their companies"
  ON clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert clients for their companies"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update clients of their companies"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete clients of their companies"
  ON clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = clients.company_id
      AND companies.user_id = auth.uid()
    )
  );

-- Tabela de produtos
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price decimal(10,2) NOT NULL DEFAULT 0,
  ispc_category text NOT NULL,
  ispc_rate decimal(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view products of their companies"
  ON products FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert products for their companies"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update products of their companies"
  ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete products of their companies"
  ON products FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.user_id = auth.uid()
    )
  );

-- Tabela de facturas
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal decimal(10,2) NOT NULL DEFAULT 0,
  ispc_amount decimal(10,2) NOT NULL DEFAULT 0,
  total decimal(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  payment_date date,
  payment_method text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('pendente', 'paga', 'vencida'))
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices of their companies"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoices for their companies"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoices of their companies"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete invoices of their companies"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.user_id = auth.uid()
    )
  );

-- Tabela de itens de factura
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity decimal(10,2) NOT NULL DEFAULT 1,
  unit_price decimal(10,2) NOT NULL DEFAULT 0,
  ispc_rate decimal(5,2) NOT NULL DEFAULT 0,
  ispc_amount decimal(10,2) NOT NULL DEFAULT 0,
  total decimal(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoice items of their companies"
  ON invoice_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoice items for their companies"
  ON invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoice items of their companies"
  ON invoice_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete invoice items of their companies"
  ON invoice_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON companies.id = invoices.company_id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.user_id = auth.uid()
    )
  );

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_company_id ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Função para actualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
