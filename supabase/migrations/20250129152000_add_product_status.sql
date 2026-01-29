-- Adicionar coluna is_active à tabela de produtos
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Actualizar política de actualização para coincidir com a nova coluna (embora o RLS já cubra se for do mesmo utilizador)
-- Não é estritamente necessário mudar a política se ela já for genérica
