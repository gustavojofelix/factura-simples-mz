/*
  # Adicionar campos faltantes em produtos e documentos em clientes

  1. Alterações na tabela `products`
    - Adicionar coluna `type` (text): 'produto' ou 'servico'
    - Adicionar coluna `unit` (text): unidade de medida (kg, un, m, etc)
    - Adicionar coluna `stock` (numeric): quantidade em stock (nullable)
    
  2. Alterações na tabela `clients`
    - Adicionar coluna `document_url` (text): URL do documento de identificação
    - Adicionar coluna `document_type` (text): tipo do documento (NUIT, BI, etc)
    
  3. Notas
    - Produtos do tipo 'servico' não precisam de stock
    - Produtos do tipo 'produto' podem ter stock controlado
    - Documentos são opcionais mas recomendados para clientes corporativos
*/

-- Adicionar tipo de produto (default 'produto' para compatibilidade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'type'
  ) THEN
    ALTER TABLE products ADD COLUMN type text DEFAULT 'produto' NOT NULL;
  END IF;
END $$;

-- Adicionar unidade de medida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'unit'
  ) THEN
    ALTER TABLE products ADD COLUMN unit text DEFAULT 'un';
  END IF;
END $$;

-- Adicionar stock (nullable, apenas para produtos físicos)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'stock'
  ) THEN
    ALTER TABLE products ADD COLUMN stock numeric;
  END IF;
END $$;

-- Adicionar campos de documento ao cliente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'document_url'
  ) THEN
    ALTER TABLE clients ADD COLUMN document_url text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'document_type'
  ) THEN
    ALTER TABLE clients ADD COLUMN document_type text;
  END IF;
END $$;

-- Adicionar check constraint para tipo de produto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_type_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_type_check 
      CHECK (type IN ('produto', 'servico'));
  END IF;
END $$;
