/*
  # Update Company Tax Fields
  
  1. Changes
    - Rename `business_activity_type` to `business_volume`
    - Add `category1`, `category2`, `category3` columns to `companies` table
    - Drop legacy ISPC activity check constraint
*/

-- 1. Rename column and drop old constraint
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_business_activity_type_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'companies' AND column_name = 'business_activity_type'
  ) THEN
    ALTER TABLE companies RENAME COLUMN business_activity_type TO business_volume;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'companies' AND column_name = 'business_volume'
  ) THEN
    ALTER TABLE companies ADD COLUMN business_volume text DEFAULT '3';
  END IF;
END $$;

-- 2. Add category columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'category1') THEN
    ALTER TABLE companies ADD COLUMN category1 text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'category2') THEN
    ALTER TABLE companies ADD COLUMN category2 text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'category3') THEN
    ALTER TABLE companies ADD COLUMN category3 text;
  END IF;
END $$;

-- 3. Update existing data to match new format (mapping old string keys to new numeric rates)
UPDATE companies SET business_volume = '3' WHERE business_volume = 'comercio_ate_1m';
UPDATE companies SET business_volume = '4' WHERE business_volume = 'comercio_1m_2.5m';
UPDATE companies SET business_volume = '5' WHERE business_volume = 'comercio_2.5m_4m';
UPDATE companies SET business_volume = '12' WHERE business_volume = 'servicos_gerais';
UPDATE companies SET business_volume = '15' WHERE business_volume = 'servicos_liberais';
UPDATE companies SET business_volume = '3' WHERE business_volume IS NULL;
