-- Create company_documents table
CREATE TABLE IF NOT EXISTS company_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL,
  url text NOT NULL,
  file_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_company_document_type UNIQUE (company_id, type)
);

-- Enable RLS
ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;

-- Policies for company_documents
CREATE POLICY "Users can view documents of their companies"
  ON company_documents FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create documents for their companies"
  ON company_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update documents of their companies"
  ON company_documents FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete documents of their companies"
  ON company_documents FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER company_documents_updated_at
  BEFORE UPDATE ON company_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_updated_at();

-- Add index
CREATE INDEX idx_company_documents_company ON company_documents(company_id);
