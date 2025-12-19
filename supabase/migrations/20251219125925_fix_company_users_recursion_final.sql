/*
  # Corrigir Recursão Infinita - Solução Definitiva

  1. Problema Identificado
    - A política INSERT em company_users estava verificando a própria tabela company_users
    - Quando o trigger cria o primeiro owner, causa recursão infinita
    - A verificação OR com company_users no INSERT é desnecessária e causa o erro

  2. Solução
    - REMOVER completamente a política INSERT que tem OR verificando company_users
    - Criar política INSERT simples que só verifica companies.user_id
    - Isso permite que o trigger funcione sem recursão
    - Para adicionar outros usuários depois, admin/owner já existirá em company_users

  3. Notas
    - INSERT só verifica se o usuário é owner direto da empresa (companies.user_id)
    - SELECT permite ver company_users se já for membro
    - UPDATE/DELETE só para owners e admins existentes
*/

-- Remover TODAS as políticas antigas de company_users
DROP POLICY IF EXISTS "Users can view company_users of their companies" ON company_users;
DROP POLICY IF EXISTS "Owners can manage company users" ON company_users;
DROP POLICY IF EXISTS "Company owners can add users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can update company users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can remove company users" ON company_users;

-- Política SELECT: ver usuários se já for membro da empresa
CREATE POLICY "Members can view company users"
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

-- Política INSERT: APENAS verifica se é owner direto na tabela companies
-- SEM recursão - não verifica company_users!
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

-- Política UPDATE: apenas owners e admins existentes
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

-- Política DELETE: apenas owners e admins existentes
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
