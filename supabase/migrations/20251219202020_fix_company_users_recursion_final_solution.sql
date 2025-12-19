/*
  # Corrigir Recursão Infinita em company_users - Solução Final

  1. Problema
    - A política "Members can view company users" causa recursão infinita
    - Ela tenta ler company_users dentro da própria política de company_users
    
  2. Solução
    - Remover TODAS as políticas existentes
    - Criar políticas simples usando APENAS a tabela companies
    - SELECT: permite ver se é owner da empresa OU se é o próprio user_id
    - INSERT: apenas owners (via companies.user_id)
    - UPDATE: apenas owners (via companies.user_id)
    - DELETE: apenas owners (via companies.user_id)
    
  3. Segurança
    - Owners têm controlo total
    - Utilizadores podem ver seu próprio registo
    - Sem recursão porque não lemos company_users dentro das políticas
*/

-- Remover todas as políticas existentes
DROP POLICY IF EXISTS "Members can view company users" ON company_users;
DROP POLICY IF EXISTS "Company owners can add users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can update users" ON company_users;
DROP POLICY IF EXISTS "Owners and admins can remove users" ON company_users;

-- Criar políticas simples sem recursão

-- SELECT: Ver se é owner da empresa OU se é o próprio utilizador
CREATE POLICY "View own record or if company owner"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
  );

-- INSERT: Apenas owners podem adicionar utilizadores
CREATE POLICY "Company owners can add users"
  ON company_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = auth.uid()
    )
  );

-- UPDATE: Apenas owners podem actualizar utilizadores
CREATE POLICY "Company owners can update users"
  ON company_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = auth.uid()
    )
  );

-- DELETE: Apenas owners podem remover utilizadores
CREATE POLICY "Company owners can remove users"
  ON company_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_id
      AND c.user_id = auth.uid()
    )
  );
