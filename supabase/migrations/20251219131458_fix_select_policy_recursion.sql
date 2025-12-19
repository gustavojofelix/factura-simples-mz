/*
  # Corrigir Recursão na Política SELECT

  1. Problema Identificado
    - A política SELECT em company_users verifica apenas se o usuário JÁ está em company_users
    - Quando o trigger insere o PRIMEIRO owner, o SELECT é invocado e não encontra ninguém
    - Isso causa recursão porque tenta verificar company_users durante INSERT em company_users

  2. Solução
    - Política SELECT deve TAMBÉM verificar se o usuário é owner direto na tabela companies
    - Assim o primeiro INSERT pelo trigger funciona sem recursão
    - Formato: (é owner direto) OR (já é membro em company_users)

  3. Resultado
    - Owner direto pode sempre ver company_users
    - Membros existentes podem ver company_users
    - Sem recursão no primeiro INSERT
*/

-- Remover política SELECT atual
DROP POLICY IF EXISTS "Members can view company users" ON company_users;

-- Nova política SELECT sem recursão
CREATE POLICY "Members can view company users"
  ON company_users FOR SELECT
  TO authenticated
  USING (
    -- Se é owner direto da empresa (na tabela companies)
    EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = company_users.company_id
      AND c.user_id = auth.uid()
    )
    OR
    -- Ou se já é membro ativo da empresa (em company_users)
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.company_id = company_users.company_id
      AND cu.user_id = auth.uid()
      AND cu.is_active = true
    )
  );
