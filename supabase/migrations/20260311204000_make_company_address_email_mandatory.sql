-- Migration: Make address and email mandatory in companies table
-- Date: 2026-03-11

-- For existing records that might have NULL values, we set a default value
-- to allow the NOT NULL constraint to be added.
-- Note: It is better to use a placeholder than to have empty values if the system
-- expects them to be there.

UPDATE companies 
SET address = 'Endereço não especificado' 
WHERE address IS NULL OR trim(address) = '';

UPDATE companies 
SET email = 'email@nao-especificado.com' 
WHERE email IS NULL OR trim(email) = '';

-- Now we can safely set the NOT NULL constraint
ALTER TABLE companies 
ALTER COLUMN address SET NOT NULL,
ALTER COLUMN email SET NOT NULL;
