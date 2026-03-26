/*
  # Add client_code column with per-company sequential IDs (format: CL0001)

  1. Changes
    - Add `client_code` column to `clients` table (text, to hold formatted codes like CL0001)
    - Normalize existing clients: assign sequential codes per company ordered by created_at
    - Create trigger function to auto-assign next code per company on insert

  2. Notes
    - Each company has its own independent sequence starting at CL0001
    - The code is stored as text with format CL + 4-digit zero-padded number
    - Codes are never reused; new clients always get max + 1
*/

-- Step 1: Add the client_code column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code TEXT;

-- Step 2: Normalize existing client codes per company
WITH numbered AS (
  SELECT id, company_id,
    ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at ASC) as seq
  FROM clients
)
UPDATE clients
SET client_code = 'CL' || LPAD(numbered.seq::TEXT, 4, '0')
FROM numbered
WHERE clients.id = numbered.id;

-- Step 3: Create a function to auto-assign next client_code per company
CREATE OR REPLACE FUNCTION assign_client_code()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  IF NEW.client_code IS NULL OR NEW.client_code = '' THEN
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(client_code, '^CL', ''), '')::INTEGER),
      0
    ) + 1
    INTO next_seq
    FROM clients
    WHERE company_id = NEW.company_id
      AND client_code ~ '^CL[0-9]+$';

    NEW.client_code := 'CL' || LPAD(next_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to run before insert
DROP TRIGGER IF EXISTS trigger_assign_client_code ON clients;
CREATE TRIGGER trigger_assign_client_code
  BEFORE INSERT ON clients
  FOR EACH ROW
  EXECUTE FUNCTION assign_client_code();
