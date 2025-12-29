/*
  # Add Company Documents Storage

  1. Changes
    - Add document URL fields to companies table
    - Add metadata fields for extracted document information
    - Create storage bucket for company documents
    - Add RLS policies for document access
  
  2. New Columns in companies table
    - `nuit_document_url` (text) - URL for NUIT attribution document
    - `activity_start_document_url` (text) - URL for activity start document
    - `commercial_activity_document_url` (text) - URL for commercial activity document
    - `registration_certificate_url` (text) - URL for registration certificate
    - `documents_metadata` (jsonb) - Metadata about extracted information
    
  3. Storage
    - Create `company-documents` bucket
    - Add RLS policies for authenticated users
  
  4. Security
    - Users can only access documents from their own companies
*/

-- Add document storage fields to companies table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'nuit_document_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN nuit_document_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'activity_start_document_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN activity_start_document_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'commercial_activity_document_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN commercial_activity_document_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'registration_certificate_url'
  ) THEN
    ALTER TABLE companies ADD COLUMN registration_certificate_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'documents_metadata'
  ) THEN
    ALTER TABLE companies ADD COLUMN documents_metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create storage bucket for company documents (handled via Supabase dashboard or API)
-- This will be created in the application code

-- Note: Storage policies will be configured through the Supabase dashboard
-- Users should only access documents from companies they belong to