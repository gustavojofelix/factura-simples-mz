-- Migration: Add invoice theme customization columns to companies table
-- This enables the AI Invoice Designer to save and retrieve theme settings per company

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS invoice_theme_id       TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invoice_primary_color  TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invoice_accent_color   TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invoice_bg_color       TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invoice_logo_url       TEXT     DEFAULT NULL;

-- Add a comment to document the column purpose
COMMENT ON COLUMN companies.invoice_theme_id      IS 'ID of the selected invoice theme (classic, modern, minimal, corporate, creative)';
COMMENT ON COLUMN companies.invoice_primary_color IS 'Custom primary color override for the invoice theme (hex)';
COMMENT ON COLUMN companies.invoice_accent_color  IS 'Custom accent color override for the invoice theme (hex)';
COMMENT ON COLUMN companies.invoice_bg_color      IS 'Custom background color override for the invoice header (hex)';
COMMENT ON COLUMN companies.invoice_logo_url      IS 'URL to the company invoice logo stored in Supabase Storage';
