/*
  # Adicionar campos faltantes em invoice_items

  1. Alterações na tabela `invoice_items`
    - Adicionar coluna `product_name` (text): nome do produto no momento da facturação
    - Adicionar coluna `subtotal` (numeric): subtotal do item (quantidade × preço unitário)
    - Manter campo `description` para observações adicionais
    
  2. Notas
    - `product_name` armazena o nome do produto no momento da factura
    - `subtotal` = quantity × unit_price (antes de ISPC)
    - `total` = subtotal + ispc_amount (já existe)
    - Campo `description` pode ser usado para detalhes extras
*/

-- Adicionar nome do produto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'product_name'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN product_name text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Adicionar subtotal (quantidade × preço unitário, antes de impostos)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'subtotal'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN subtotal numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Remover default após adicionar (para forçar valores explícitos em novos registos)
ALTER TABLE invoice_items ALTER COLUMN product_name DROP DEFAULT;
