-- Migration: Add industry column to clients table
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'industry'
  ) THEN 
    ALTER TABLE clients ADD COLUMN industry text;
  END IF;
END $$;
