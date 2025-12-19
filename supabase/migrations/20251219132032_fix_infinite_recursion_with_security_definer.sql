/*
  # Solução Definitiva para Recursão Infinita

  ## 1. Análise Completa do Problema

  ### Causa Raiz
  Quando uma empresa é criada:
  1. O trigger `create_company_owner_trigger` executa a função `create_company_owner()`
  2. A função faz INSERT em `company_users`
  3. Durante o INSERT, o Postgres verifica as políticas RLS:
     - Política INSERT: OK (verifica companies.user_id)
     - Política SELECT: PROBLEMA! Tem duas condições com OR:
       a) Verifica se é owner em companies (OK)
       b) Verifica se já está em company_users (RECURSÃO!)
  4. A condição (b) tenta fazer SELECT em company_users enquanto está fazendo INSERT em company_users
  5. Isso cria um loop infinito → erro de recursão

  ### Por Que SELECT É Invocado Durante INSERT?
  O Postgres invoca políticas SELECT durante INSERT/UPDATE quando:
  - Há foreign keys ou constraints que precisam ser verificados
  - O código usa RETURNING ou precisa ler dados inseridos
  - Há triggers que leem a tabela
  - O sistema precisa validar unicidade ou outros constraints

  ## 2. Solução Implementada

  ### Estratégia: SECURITY DEFINER
  Modificar a função `create_company_owner()` para usar `SECURITY DEFINER`.
  Isso faz com que a função execute com os privilégios do CRIADOR (admin/superuser),
  NÃO com os privilégios do usuário que está executando (auth.uid()).

  ### Resultado
  - A função executa FORA do contexto RLS do usuário
  - As políticas RLS não são aplicadas durante a execução do trigger
  - O INSERT em company_users funciona sem verificar as políticas
  - Sem recursão!

  ### Segurança
  - A função é segura porque só é invocada pelo trigger AFTER INSERT em companies
  - Apenas usuários que podem criar companies podem ativar este trigger
  - A política INSERT em companies já garante que auth.uid() = companies.user_id
  - Portanto, o trigger só cria owner para o próprio usuário que criou a empresa

  ## 3. Mudanças Aplicadas

  - Recriar função `create_company_owner()` com SECURITY DEFINER
  - Manter todas as políticas RLS existentes intactas
  - Sem mudanças nas tabelas ou outras estruturas

  ## 4. Vantagens Desta Solução

  1. **Não quebra funcionalidade existente**: Todas as políticas RLS continuam funcionando
  2. **Seguro**: SECURITY DEFINER é seguro neste contexto específico
  3. **Simples**: Uma única mudança resolve o problema
  4. **Mantém RLS**: Usuários normais ainda estão sujeitos a todas as políticas
  5. **Sem efeitos colaterais**: Apenas o trigger executa com privilégios elevados
*/

-- Recriar a função com SECURITY DEFINER
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER 
SECURITY DEFINER -- Esta linha é a chave! Executa com privilégios do criador
SET search_path = public -- Segurança adicional: forçar search_path
AS $$
BEGIN
  -- Inserir o owner em company_users
  -- Com SECURITY DEFINER, isso executa SEM verificar as políticas RLS do usuário
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');
  
  -- Criar subscription trial
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
  
  -- Criar configurações do sistema
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comentário explicativo
COMMENT ON FUNCTION create_company_owner() IS 
'Cria automaticamente owner, subscription e settings quando uma empresa é criada. 
Usa SECURITY DEFINER para evitar recursão infinita nas políticas RLS de company_users.
Seguro porque só é executado pelo trigger AFTER INSERT em companies, que já valida 
que o usuário só pode criar empresas para si mesmo (auth.uid() = companies.user_id).';
