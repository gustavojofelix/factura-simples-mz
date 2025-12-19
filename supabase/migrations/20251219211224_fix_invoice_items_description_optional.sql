/*
  # Make invoice_items description field optional

  1. Changes
    - Alter invoice_items table to make description column nullable
    - This allows creating invoice items with just product_name

  2. Reason
    - The product_name field already contains the product name
    - Description can be optional for additional notes or details
*/

ALTER TABLE invoice_items ALTER COLUMN description DROP NOT NULL;
