/*
  # Corrigir Recursão na Política SELECT de Companies

  ## 1. Problema Identificado
  
  Recursão circular entre companies e company_users:
  - SELECT em `companies` verifica EXISTS em `company_users`
  - SELECT em `company_users` verifica EXISTS em `companies`
  - Resultado: infinite recursion!

  ## 2. Solução
  
  Para a política SELECT de companies:
  - Remover o EXISTS que verifica company_users
  - Manter APENAS `auth.uid() = user_id`
  - Isso funciona porque:
    * No INSERT: usuário é owner direto
    * Após trigger: usuário já está em company_users
    * Para SELECT: basta verificar se é owner direto

  ## 3. Políticas Finais de Companies
  
  - INSERT: Apenas auth.uid() = user_id (sem recursão)
  - SELECT: Apenas auth.uid() = user_id (sem recursão!)
  - UPDATE/DELETE: Pode verificar company_users (após INSERT, seguro)
*/

-- Remover a política SELECT antiga que causa recursão
DROP POLICY IF EXISTS "Users can view their companies" ON companies;

-- Criar nova política SELECT sem recursão
CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Comentário explicativo
COMMENT ON TABLE companies IS 
'Tabela de empresas. Políticas RLS:
- INSERT: Apenas owner direto (auth.uid() = user_id)
- SELECT: Apenas owner direto (SEM verificar company_users para evitar recursão)
- UPDATE/DELETE: Owner direto OU admin/owner em company_users (após INSERT)

IMPORTANTE: A política SELECT é intencionalmentesimplificada para evitar recursão
circular com company_users. Usuários veem apenas empresas onde são owners diretos.';
