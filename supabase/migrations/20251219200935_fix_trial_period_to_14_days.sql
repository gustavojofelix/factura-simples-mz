/*
  # Corrigir Período de Trial para 14 Dias

  1. Alterações
    - Atualizar trigger create_company_owner() para definir trial de 14 dias em vez de 30
    - Calcular end_date corretamente como start_date + 14 dias
    - Manter next_billing_date também em 14 dias

  2. Notas Importantes
    - Esta alteração afeta apenas novas empresas criadas após esta migração
    - Empresas existentes não são afetadas (mas atualmente não há nenhuma)
*/

-- Recriar função para criar automaticamente owner, subscription e settings com trial de 14 dias
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER AS $$
BEGIN
  -- Criar owner na tabela company_users
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');
  
  -- Criar subscription com trial de 14 dias
  INSERT INTO subscriptions (
    company_id, 
    plan_name, 
    status, 
    billing_cycle, 
    amount, 
    start_date, 
    end_date,
    next_billing_date
  )
  VALUES (
    NEW.id,
    'Trial',
    'trialing',
    'monthly',
    0,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '14 days'
  );
  
  -- Criar configurações do sistema
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
