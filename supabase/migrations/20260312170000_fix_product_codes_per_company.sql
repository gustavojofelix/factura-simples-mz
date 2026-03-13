/*
  # Fix product codes to be per-company sequential

  1. Changes
    - Drop the global SERIAL sequence from the `code` column
    - Normalize existing codes per company (starting from 1)
    - Create a trigger to auto-assign the next code per company on insert
    
  2. Notes
    - Each company will have its own independent code sequence starting at 1
    - Codes are never reused (they represent the next max + 1)
    - Existing products are renumbered per company ordered by created_at
*/

-- Step 1: Drop the default sequence from the code column
-- The SERIAL type creates a sequence, we need to remove the default
ALTER TABLE products ALTER COLUMN code DROP DEFAULT;

-- Drop the sequence if it exists (created by SERIAL)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'products_code_seq') THEN
    DROP SEQUENCE products_code_seq;
  END IF;
END $$;

-- Step 2: Normalize existing product codes per company
-- Re-assign codes starting from 1 for each company, ordered by created_at
WITH numbered AS (
  SELECT id, company_id,
    ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at ASC) as new_code
  FROM products
)
UPDATE products
SET code = numbered.new_code
FROM numbered
WHERE products.id = numbered.id;

-- Step 3: Create a function to auto-assign next code per company
CREATE OR REPLACE FUNCTION assign_product_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = 0 THEN
    SELECT COALESCE(MAX(code), 0) + 1
    INTO NEW.code
    FROM products
    WHERE company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to run before insert
DROP TRIGGER IF EXISTS trigger_assign_product_code ON products;
CREATE TRIGGER trigger_assign_product_code
  BEFORE INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION assign_product_code();
