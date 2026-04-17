/*
  # Add subscriber_code to profiles table (format: SUB0001)

  1. Changes
    - Add `subscriber_code` column to `profiles` table (text)
    - Normalize existing profiles: assign sequential codes ordered by created_at
    - Create trigger to auto-assign next code on insert

  2. Notes
    - Subscriber codes are GLOBAL (not per-company) since profiles are auth-level
    - Format: SUB + 4-digit zero-padded number (SUB0001, SUB0002, etc.)
    - Codes are never reused; new subscribers always get max + 1
*/

-- Step 1: Add the subscriber_code column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscriber_code TEXT;

-- Step 2: Normalize existing profile codes
WITH numbered AS (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC) as seq
  FROM profiles
)
UPDATE profiles
SET subscriber_code = 'SUB' || LPAD(numbered.seq::TEXT, 4, '0')
FROM numbered
WHERE profiles.id = numbered.id;

-- Step 3: Create a function to auto-assign next subscriber_code
CREATE OR REPLACE FUNCTION assign_subscriber_code()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  IF NEW.subscriber_code IS NULL OR NEW.subscriber_code = '' THEN
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(subscriber_code, '^SUB', ''), '')::INTEGER),
      0
    ) + 1
    INTO next_seq
    FROM profiles
    WHERE subscriber_code ~ '^SUB[0-9]+$';

    NEW.subscriber_code := 'SUB' || LPAD(next_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to run before insert
DROP TRIGGER IF EXISTS trigger_assign_subscriber_code ON profiles;
CREATE TRIGGER trigger_assign_subscriber_code
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION assign_subscriber_code();
