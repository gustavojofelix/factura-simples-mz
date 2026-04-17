/*
  # Add company_code to companies table (format: CTB0001)

  1. Changes
    - Add `company_code` column to `companies` table (text)
    - Normalize existing companies: assign sequential codes ordered by created_at
    - Create trigger to auto-assign next code on insert

  2. Notes
    - Company codes are GLOBAL (unique across the entire platform)
    - Format: CTB + 4-digit zero-padded number (CTB0001, CTB0002, etc.)
    - Codes are never reused; new companies always get max + 1
*/

-- Step 1: Add the company_code column
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_code TEXT;

-- Step 2: Normalize existing company codes
WITH numbered AS (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC) as seq
  FROM companies
)
UPDATE companies
SET company_code = 'CTB' || LPAD(numbered.seq::TEXT, 4, '0')
FROM numbered
WHERE companies.id = numbered.id;

-- Step 3: Create a function to auto-assign next company_code
CREATE OR REPLACE FUNCTION assign_company_code()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  IF NEW.company_code IS NULL OR NEW.company_code = '' THEN
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(company_code, '^CTB', ''), '')::INTEGER),
      0
    ) + 1
    INTO next_seq
    FROM companies
    WHERE company_code ~ '^CTB[0-9]+$';

    NEW.company_code := 'CTB' || LPAD(next_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to run before insert
DROP TRIGGER IF EXISTS trigger_assign_company_code ON companies;
CREATE TRIGGER trigger_assign_company_code
  BEFORE INSERT ON companies
  FOR EACH ROW
  EXECUTE FUNCTION assign_company_code();
