/*
  # Convert product codes to type-based format (PRD0001 / SRV0001)

  1. Changes
    - Convert `code` column from integer to text
    - Normalize existing products: PRD prefix for 'produto', SRV for 'servico'
    - Each type has its own independent counter per company
    - Replace the old trigger with a new type-aware one

  2. Format
    - Products: PRD0001, PRD0002, PRD0003...
    - Services: SRV0001, SRV0002, SRV0003...
    - Counters are independent per type and per company
*/

-- Step 1: Convert code column from integer to text
ALTER TABLE products ALTER COLUMN code TYPE TEXT USING code::TEXT;

-- Step 2: Normalize existing product codes per company and type
WITH numbered AS (
  SELECT id, company_id, type,
    ROW_NUMBER() OVER (PARTITION BY company_id, type ORDER BY created_at ASC) as seq
  FROM products
)
UPDATE products
SET code = CASE
  WHEN numbered.type = 'servico' THEN 'SRV' || LPAD(numbered.seq::TEXT, 4, '0')
  ELSE 'PRD' || LPAD(numbered.seq::TEXT, 4, '0')
END
FROM numbered
WHERE products.id = numbered.id;

-- Step 3: Replace the trigger function with type-aware version
CREATE OR REPLACE FUNCTION assign_product_code()
RETURNS TRIGGER AS $$
DECLARE
  prefix TEXT;
  next_seq INTEGER;
BEGIN
  -- Determine prefix based on product type
  IF NEW.type = 'servico' THEN
    prefix := 'SRV';
  ELSE
    prefix := 'PRD';
  END IF;

  -- Auto-assign code if not provided
  IF NEW.code IS NULL OR NEW.code = '' OR NEW.code ~ '^\d+$' THEN
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(code, '^' || prefix, ''), '')::INTEGER),
      0
    ) + 1
    INTO next_seq
    FROM products
    WHERE company_id = NEW.company_id
      AND code ~ ('^' || prefix || '[0-9]+$');

    NEW.code := prefix || LPAD(next_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Ensure trigger exists
DROP TRIGGER IF EXISTS trigger_assign_product_code ON products;
CREATE TRIGGER trigger_assign_product_code
  BEFORE INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION assign_product_code();
