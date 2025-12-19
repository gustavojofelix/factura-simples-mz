/*
  # Remover TODAS as Políticas Antigas e Duplicadas

  ## 1. Problema Identificado
  
  Há políticas DUPLICADAS e antigas que ainda causam recursão:
  - "Users can view company users" - recursão no SELECT
  - "Company owners can manage users" - política antiga com FOR ALL que causa recursão
  - Estas coexistem com as políticas corretas que criamos

  ## 2. Solução
  
  - Remover TODAS as políticas antigas de company_users
  - Recriar APENAS as 4 políticas corretas (SELECT, INSERT, UPDATE, DELETE)
  - Garantir que não há recursão em nenhuma delas

  ## 3. Políticas Corretas
  
  - SELECT: Verifica companies.user_id OU company_users (com OR é seguro)
  - INSERT: Verifica APENAS companies.user_id (sem recursão)
  - UPDATE: Verifica companies.user_id OU company_users (após INSERT, é seguro)
  - DELETE: Verifica companies.user_id OU company_users (após INSERT, é seguro)
*/

-- Remover TODAS as políticas antigas de company_users
DROP POLICY IF EXISTS "Users can view company users" ON company_users;
DROP POLICY IF EXISTS "Users can view company_users of their companies" ON company_users;
DROP POLICY IF EXISTS "Owners can manage company users" ON company_users;
DROP POLICY IF EXISTS "Company owners can add users" ON company_users;
DROP POLICY IF EXISTS "Company owners can manage users" ON company_users;
DROP POLICY IF EXISTS "Members can view company users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can update users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can remove users" ON company_users;

-- Agora criar APENAS as 4 políticas corretas

-- 1. SELECT: Owner direto OU membro existente (com OR é seguro)
CREATE POLICY "Members can view company users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    -- Owner direto na tabela companies
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
    OR
    -- Ou já é membro ativo (após o primeiro INSERT pelo trigger)
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.is_active = true
    )
  );

-- 2. INSERT: APENAS owner direto (sem recursão)
CREATE POLICY "Company owners can add users"
  ON company_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
  );

-- 3. UPDATE: Owner direto OU admin/owner existente
CREATE POLICY "Owners and admins can update users"
  ON company_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.role IN ('owner', 'admin')
      AND cu.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.role IN ('owner', 'admin')
      AND cu.is_active = true
    )
  );

-- 4. DELETE: Owner direto OU admin/owner existente
CREATE POLICY "Owners and admins can remove users"
  ON company_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.role IN ('owner', 'admin')
      AND cu.is_active = true
    )
  );

-- Comentário final
COMMENT ON TABLE company_users IS 
'Tabela de usuários por empresa. Políticas RLS:
- SELECT: Owner direto OU membro existente
- INSERT: Apenas owner direto (trigger usa SECURITY DEFINER)
- UPDATE/DELETE: Owner direto OU admin/owner existente';
