/*
  # Limpeza Completa da Base de Dados

  1. Descrição
    - Remove TODOS os dados de TODAS as tabelas
    - Inclui limpeza da tabela auth.users
    - Respeita ordem de foreign keys para evitar erros
    
  2. Tabelas Limpas
    - auth.users (utilizadores autenticados)
    - auth.identities (identidades de utilizadores)
    - profiles (perfis de utilizadores)
    - tax_payments (pagamentos de impostos)
    - tax_declarations (declarações de impostos)
    - payments (pagamentos de facturas)
    - invoice_items (itens de facturas)
    - invoices (facturas)
    - products (produtos)
    - clients (clientes)
    - company_users (utilizadores de empresas)
    - subscriptions (subscrições)
    - companies (empresas)
    - system_settings (configurações do sistema)
    
  3. Nota
    - Esta operação remove TODOS os dados
    - Base de dados ficará completamente limpa
    - Pronta para novos registos
*/

-- Desabilitar triggers temporariamente para evitar problemas
SET session_replication_role = replica;

-- Limpar dados em ordem reversa de dependências

-- 1. Pagamentos de impostos
TRUNCATE TABLE tax_payments CASCADE;

-- 2. Declarações de impostos
TRUNCATE TABLE tax_declarations CASCADE;

-- 3. Pagamentos de facturas
TRUNCATE TABLE payments CASCADE;

-- 4. Itens de facturas
TRUNCATE TABLE invoice_items CASCADE;

-- 5. Facturas
TRUNCATE TABLE invoices CASCADE;

-- 6. Produtos
TRUNCATE TABLE products CASCADE;

-- 7. Clientes
TRUNCATE TABLE clients CASCADE;

-- 8. Utilizadores de empresas
TRUNCATE TABLE company_users CASCADE;

-- 9. Subscrições
TRUNCATE TABLE subscriptions CASCADE;

-- 10. Empresas
TRUNCATE TABLE companies CASCADE;

-- 11. Configurações do sistema
TRUNCATE TABLE system_settings CASCADE;

-- 12. Perfis
TRUNCATE TABLE profiles CASCADE;

-- 13. Limpar auth.identities (identidades de autenticação)
DELETE FROM auth.identities;

-- 14. Limpar auth.users (utilizadores autenticados)
DELETE FROM auth.users;

-- Reabilitar triggers
SET session_replication_role = DEFAULT;
