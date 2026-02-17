-- Migration to add created_by column to invoices table

-- 1. Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE invoices ADD COLUMN created_by uuid REFERENCES profiles(id);
  END IF;
END $$;

-- 2. Ensure relationship points to profiles(id) and has a consistent name for PostgREST
-- This fixes issues where the column might have been created referencing auth.users directly
DO $$
BEGIN
  -- Drop existing constraint if it points to auth.users or has a different name
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_created_by_fkey;
  
  -- Add the correct constraint
  ALTER TABLE invoices ADD CONSTRAINT invoices_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not update constraint: %', SQLERRM;
END $$;

-- 3. Add index for better JOIN performance
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(created_by);

-- 4. Optional: Associate existing invoices with company owner if created_by is null
UPDATE invoices i
SET created_by = c.user_id
FROM companies c
WHERE i.company_id = c.id
AND i.created_by IS NULL;
