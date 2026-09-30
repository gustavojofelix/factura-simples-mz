/*
  # Add barcode to products

  1. Changes
    - Add optional `barcode` text column to `products`
    - Barcodes are unique per company (when provided)
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_company_barcode_key
  ON products (company_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

NOTIFY pgrst, 'reload schema';
