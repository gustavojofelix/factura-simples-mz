-- Adicionar coluna is_active à tabela de clientes
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
