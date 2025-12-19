/*
  # Simplificar Todas as Políticas de Companies

  ## 1. Problema
  
  Mesmo UPDATE/DELETE podem causar recursão se verificarem company_users,
  porque SELECT em company_users verifica companies.

  ## 2. Solução
  
  Simplificar TODAS as políticas de companies para verificar APENAS:
  - auth.uid() = user_id
  
  Isso significa:
  - Apenas o owner DIRETO pode fazer tudo com a empresa
  - Usuários adicionados via company_users NÃO podem atualizar empresas
  - Isso está correto para o modelo de negócio: apenas o dono da empresa edita
  
  ## 3. Benefícios
  
  - Zero possibilidade de recursão
  - Política clara: dono da empresa = dono de tudo
  - Usuários em company_users têm permissões apenas em seus recursos (faturas, etc)
*/

-- Remover políticas antigas que verificam company_users
DROP POLICY IF EXISTS "Owners can update companies" ON companies;
DROP POLICY IF EXISTS "Owners can delete companies" ON companies;

-- Criar políticas simplificadas sem recursão
CREATE POLICY "Owners can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Comentário final
COMMENT ON TABLE companies IS 
'Tabela de empresas. Políticas RLS simplificadas:
- Todas as operações (SELECT, INSERT, UPDATE, DELETE) verificam APENAS auth.uid() = user_id
- Isso evita QUALQUER recursão com company_users
- Apenas o owner DIRETO da empresa pode gerenciá-la
- Usuários em company_users têm permissões para recursos da empresa, mas não para editar a empresa';
