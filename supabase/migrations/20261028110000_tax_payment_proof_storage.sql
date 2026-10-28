-- Comprovativos de pagamento de impostos (declarações ISPC).
--
-- Os ficheiros ficam no bucket privado company-documents, em
-- <company_id>/tax_payment_<timestamp>.<ext>, e tax_payments.receipt_url guarda
-- o caminho dentro do bucket (registos antigos podem ter uma URL externa).
-- Leitura: membros da empresa. Escrita: dono da empresa ou membro com papel
-- owner/admin/manager. O registo em tax_payments continua sujeito à sua RLS.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('company-documents', 'company-documents', false)
  ON CONFLICT (id) DO NOTHING;

  DROP POLICY IF EXISTS "Company members can read tax payment proofs" ON storage.objects;
  CREATE POLICY "Company members can read tax payment proofs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'tax\_payment\_%'
      AND (
        EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id::text = (storage.foldername(name))[1]
            AND c.user_id = auth.uid()
        )
      )
    );

  DROP POLICY IF EXISTS "Company managers can upload tax payment proofs" ON storage.objects;
  CREATE POLICY "Company managers can upload tax payment proofs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'tax\_payment\_%'
      AND (
        EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
            AND cu.role IN ('owner', 'admin', 'manager')
        )
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id::text = (storage.foldername(name))[1]
            AND c.user_id = auth.uid()
        )
      )
    );

  DROP POLICY IF EXISTS "Company managers can delete tax payment proofs" ON storage.objects;
  CREATE POLICY "Company managers can delete tax payment proofs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'tax\_payment\_%'
      AND (
        EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
            AND cu.role IN ('owner', 'admin', 'manager')
        )
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id::text = (storage.foldername(name))[1]
            AND c.user_id = auth.uid()
        )
      )
    );
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
    RAISE NOTICE 'Políticas de armazenamento dos comprovativos de impostos não aplicadas (%). Configure-as no painel do Supabase.', SQLERRM;
END;
$$;
