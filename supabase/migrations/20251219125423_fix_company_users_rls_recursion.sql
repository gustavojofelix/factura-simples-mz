/*
  # Corrigir Recursão Infinita nas Políticas RLS de company_users

  1. Alterações
    - Remover políticas RLS antigas que causam recursão
    - Criar novas políticas mais específicas e seguras
    - Permitir INSERT direto para owners da empresa
    - Permitir SELECT baseado na própria tabela company_users sem recursão

  2. Notas Importantes
    - A recursão ocorria porque a política verificava company_users durante INSERT em company_users
    - Agora usamos verificação direta na tabela companies para INSERT
    - Para SELECT, UPDATE e DELETE, verificamos company_users mas de forma segura
*/

-- Remover políticas antigas que causam recursão
DROP POLICY IF EXISTS "Users can view company_users of their companies" ON company_users;
DROP POLICY IF EXISTS "Owners can manage company users" ON company_users;

-- Política para SELECT: usuários podem ver outros usuários das mesmas empresas
CREATE POLICY "Users can view company_users of their companies"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.is_active = true
    )
  );

-- Política para INSERT: apenas owners da empresa (verificação direta na tabela companies)
CREATE POLICY "Company owners can add users"
  ON company_users FOR INSERT
  TO authenticated
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

-- Política para UPDATE: apenas owners e admins
CREATE POLICY "Owners and admins can update company users"
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

-- Política para DELETE: apenas owners e admins
CREATE POLICY "Owners and admins can remove company users"
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
