-- Add sequential code to products
ALTER TABLE products ADD COLUMN code SERIAL;

-- Update existing products to have a code (though SERIAL handles this on addition, 
-- existing rows might need it if not already set by SERIAL during alter)
-- Actually PostgreSQL ALTER TABLE ... ADD COLUMN SERIAL handles existing rows automatically.
