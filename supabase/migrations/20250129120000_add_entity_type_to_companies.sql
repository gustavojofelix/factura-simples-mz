-- Add entity_type column to companies table
ALTER TABLE companies 
ADD COLUMN entity_type text CHECK (entity_type IN ('singular', 'collective'));

-- Update existing records to have a default value if needed (optional)
UPDATE companies SET entity_type = 'singular' WHERE entity_type IS NULL;

-- Make it required if that's the business rule
ALTER TABLE companies ALTER COLUMN entity_type SET NOT NULL;
