/*
  # Sistema Completo de Gestão de Configurações

  1. Novas Tabelas
    - `company_users` - Relacionamento muitos-para-muitos entre usuários e empresas
      - `id` (uuid, primary key)
      - `company_id` (uuid, referência a companies)
      - `user_id` (uuid, referência a auth.users)
      - `role` (text, papel: owner, admin, manager, user)
      - `is_active` (boolean, usuário ativo na empresa)
      - `permissions` (jsonb, permissões específicas)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `subscriptions` - Subscrições por empresa
      - `id` (uuid, primary key)
      - `company_id` (uuid, referência a companies)
      - `plan_name` (text, nome do plano)
      - `status` (text, status: active, past_due, cancelled, trialing)
      - `billing_cycle` (text, ciclo: monthly, yearly)
      - `amount` (decimal, valor)
      - `currency` (text, moeda)
      - `payment_method` (text, método de pagamento)
      - `start_date` (date, data de início)
      - `end_date` (date, data de fim)
      - `next_billing_date` (date, próxima cobrança)
      - `auto_renew` (boolean, renovação automática)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `system_settings` - Configurações do sistema por empresa
      - `id` (uuid, primary key)
      - `company_id` (uuid, referência a companies)
      - `language` (text, idioma)
      - `timezone` (text, fuso horário)
      - `currency` (text, moeda)
      - `date_format` (text, formato de data)
      - `fiscal_year_start` (text, início do ano fiscal)
      - `enable_notifications` (boolean)
      - `notification_email` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Alterações na Tabela companies
    - Adicionar campos: phone, email, logo_url, nuit_document_url
    - Adicionar campos bancários: bank_name, bank_account, bank_iban, bank_swift

  3. Segurança
    - RLS em todas as tabelas
    - Políticas baseadas em company_users para acesso multi-usuário
    - Apenas owners podem gerir utilizadores
*/

-- Adicionar campos à tabela companies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'phone'
  ) THEN
    ALTER TABLE companies ADD COLUMN phone text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'email'
  ) THEN
    ALTER TABLE companies ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'logo_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN logo_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'nuit_document_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN nuit_document_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE companies ADD COLUMN bank_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'bank_account'
  ) THEN
    ALTER TABLE companies ADD COLUMN bank_account text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'bank_iban'
  ) THEN
    ALTER TABLE companies ADD COLUMN bank_iban text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'bank_swift'
  ) THEN
    ALTER TABLE companies ADD COLUMN bank_swift text;
  END IF;
END $$;

-- Tabela de relacionamento usuários-empresas
CREATE TABLE IF NOT EXISTS company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  is_active boolean DEFAULT true,
  permissions jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_role CHECK (role IN ('owner', 'admin', 'manager', 'user')),
  CONSTRAINT unique_company_user UNIQUE(company_id, user_id)
);

ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view company_users of their companies"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage company users"
  ON company_users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.role IN ('owner', 'admin')
    )
  );

-- Tabela de subscrições
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Trial',
  status text NOT NULL DEFAULT 'trialing',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount decimal(10,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'MZN',
  payment_method text,
  start_date date DEFAULT CURRENT_DATE,
  end_date date,
  next_billing_date date,
  auto_renew boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  CONSTRAINT valid_billing_cycle CHECK (billing_cycle IN ('monthly', 'yearly')),
  CONSTRAINT unique_company_subscription UNIQUE(company_id)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view subscriptions of their companies"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage subscriptions"
  ON subscriptions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  );

-- Tabela de configurações do sistema
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  language text DEFAULT 'pt',
  timezone text DEFAULT 'Africa/Maputo',
  currency text DEFAULT 'MZN',
  date_format text DEFAULT 'DD/MM/YYYY',
  fiscal_year_start text DEFAULT '01-01',
  enable_notifications boolean DEFAULT true,
  notification_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_company_settings UNIQUE(company_id)
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view settings of their companies"
  ON system_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage settings"
  ON system_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = system_settings.company_id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  );

-- Atualizar políticas RLS da tabela companies para suportar acesso multi-usuário
DROP POLICY IF EXISTS "Users can view own companies" ON companies;
DROP POLICY IF EXISTS "Users can insert own companies" ON companies;
DROP POLICY IF EXISTS "Users can update own companies" ON companies;
DROP POLICY IF EXISTS "Users can delete own companies" ON companies;

CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = companies.id
      AND company_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = companies.id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = companies.id
      AND company_users.user_id = auth.uid()
      AND company_users.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Owners can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_user_id ON company_users(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_id ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_company_id ON system_settings(company_id);

-- Triggers para atualizar updated_at
CREATE TRIGGER update_company_users_updated_at BEFORE UPDATE ON company_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Função para criar automaticamente um registro company_users quando uma empresa é criada
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');
  
  INSERT INTO subscriptions (company_id, plan_name, status, billing_cycle, amount, start_date, next_billing_date)
  VALUES (
    NEW.id,
    'Trial',
    'trialing',
    'monthly',
    0,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days'
  );
  
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_company_owner_trigger
  AFTER INSERT ON companies
  FOR EACH ROW
  EXECUTE FUNCTION create_company_owner();
