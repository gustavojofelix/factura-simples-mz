-- Migration: Contas bancárias múltiplas por empresa
-- Descrição: Até aqui cada empresa só podia ter um banco, guardado em colunas
-- soltas da tabela companies (bank_name, bank_account, bank_iban, bank_swift,
-- nib). Esta migração cria a tabela company_bank_accounts, com um documento
-- comprovativo opcional por conta, copia o banco existente de cada empresa para
-- a nova tabela e marca as colunas antigas como obsoletas (sem as apagar).
--
-- M-Pesa e e-Mola continuam como campos únicos em companies.

CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_name text NOT NULL CHECK (char_length(trim(bank_name)) BETWEEN 1 AND 120),
  account_holder text CHECK (account_holder IS NULL OR char_length(account_holder) <= 160),
  account_number text CHECK (account_number IS NULL OR char_length(account_number) <= 60),
  nib text CHECK (nib IS NULL OR char_length(nib) <= 40),
  iban text CHECK (iban IS NULL OR char_length(iban) <= 40),
  swift text CHECK (swift IS NULL OR char_length(swift) <= 15),
  currency text NOT NULL DEFAULT 'MZN' CHECK (currency ~ '^[A-Z]{3}$'),
  is_default boolean NOT NULL DEFAULT false,
  show_on_invoice boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  -- Caminho do comprovativo dentro do bucket company-documents
  document_path text CHECK (document_path IS NULL OR char_length(document_path) <= 500),
  document_file_name text CHECK (document_file_name IS NULL OR char_length(document_file_name) <= 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_bank_accounts IS 'Contas bancárias de cada empresa. As marcadas com show_on_invoice aparecem nas facturas e extractos, a conta por omissão primeiro.';
COMMENT ON COLUMN public.company_bank_accounts.document_path IS 'Caminho do comprovativo de dados bancários no bucket company-documents (ex.: <company_id>/bank_details_<ts>.pdf).';
COMMENT ON COLUMN public.company_bank_accounts.is_default IS 'Conta principal da empresa. No máximo uma por empresa.';

CREATE INDEX IF NOT EXISTS idx_company_bank_accounts_company
  ON public.company_bank_accounts (company_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_bank_accounts_default
  ON public.company_bank_accounts (company_id)
  WHERE is_default;

-- Leitura aberta a qualquer membro da empresa, porque quem emite facturas pode
-- ter um papel inferior e o documento tem de mostrar os bancos. A escrita fica
-- reservada ao dono/administrador da empresa e ao super administrador.
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view company bank accounts" ON public.company_bank_accounts;
CREATE POLICY "Members can view company bank accounts"
  ON public.company_bank_accounts FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id) OR public.is_admin());

DROP POLICY IF EXISTS "Owners can insert company bank accounts" ON public.company_bank_accounts;
CREATE POLICY "Owners can insert company bank accounts"
  ON public.company_bank_accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = company_bank_accounts.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_bank_accounts.company_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update company bank accounts" ON public.company_bank_accounts;
CREATE POLICY "Owners can update company bank accounts"
  ON public.company_bank_accounts FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = company_bank_accounts.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_bank_accounts.company_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = company_bank_accounts.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_bank_accounts.company_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete company bank accounts" ON public.company_bank_accounts;
CREATE POLICY "Owners can delete company bank accounts"
  ON public.company_bank_accounts FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = company_bank_accounts.company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = company_bank_accounts.company_id
        AND c.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS company_bank_accounts_updated_at ON public.company_bank_accounts;
CREATE TRIGGER company_bank_accounts_updated_at
  BEFORE UPDATE ON public.company_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Gravação atómica da lista completa de contas de uma empresa (usada pelo
-- diálogo da empresa). Apaga as contas que saíram, limpa a conta por omissão e
-- insere/actualiza as restantes pela ordem recebida, tudo numa só transacção:
-- se alguma linha falhar (ex.: CHECK), nada fica gravado.
-- SECURITY INVOKER: as políticas RLS acima continuam a aplicar-se; a verificação
-- explícita serve só para devolver um erro claro em vez de uma gravação vazia.
CREATE OR REPLACE FUNCTION public.save_company_bank_accounts(p_company_id uuid, p_accounts jsonb)
RETURNS SETOF public.company_bank_accounts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_index integer := 0;
  v_keep uuid[];
  v_default_index integer;
BEGIN
  IF p_company_id IS NULL OR p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'Dados bancários inválidos.' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = p_company_id
        AND cu.user_id = auth.uid()
        AND cu.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = p_company_id AND c.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Só o dono ou um administrador da empresa pode alterar os dados bancários.'
      USING ERRCODE = '42501';
  END IF;

  -- Exactamente uma conta por omissão: a primeira marcada, ou a primeira da lista.
  SELECT min(ord) - 1 INTO v_default_index
  FROM jsonb_array_elements(p_accounts) WITH ORDINALITY AS e(item, ord)
  WHERE coalesce((e.item->>'is_default')::boolean, false);
  IF v_default_index IS NULL THEN v_default_index := 0; END IF;

  SELECT coalesce(array_agg((e.item->>'id')::uuid), '{}')
  INTO v_keep
  FROM jsonb_array_elements(p_accounts) AS e(item)
  WHERE nullif(e.item->>'id', '') IS NOT NULL;

  DELETE FROM public.company_bank_accounts
  WHERE company_id = p_company_id
    AND NOT (id = ANY (v_keep));

  UPDATE public.company_bank_accounts
  SET is_default = false
  WHERE company_id = p_company_id AND is_default;

  FOR v_item IN SELECT item FROM jsonb_array_elements(p_accounts) AS e(item) LOOP
    IF nullif(v_item->>'id', '') IS NOT NULL THEN
      UPDATE public.company_bank_accounts SET
        bank_name = v_item->>'bank_name',
        account_holder = nullif(v_item->>'account_holder', ''),
        account_number = nullif(v_item->>'account_number', ''),
        nib = nullif(v_item->>'nib', ''),
        iban = nullif(v_item->>'iban', ''),
        swift = nullif(v_item->>'swift', ''),
        currency = coalesce(nullif(v_item->>'currency', ''), 'MZN'),
        is_default = (v_index = v_default_index),
        show_on_invoice = coalesce((v_item->>'show_on_invoice')::boolean, true),
        sort_order = v_index,
        document_path = nullif(v_item->>'document_path', ''),
        document_file_name = nullif(v_item->>'document_file_name', '')
      WHERE id = (v_item->>'id')::uuid
        AND company_id = p_company_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta bancária não encontrada (pode ter sido removida noutra sessão).'
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      INSERT INTO public.company_bank_accounts (
        company_id, bank_name, account_holder, account_number, nib, iban, swift,
        currency, is_default, show_on_invoice, sort_order, document_path, document_file_name
      ) VALUES (
        p_company_id,
        v_item->>'bank_name',
        nullif(v_item->>'account_holder', ''),
        nullif(v_item->>'account_number', ''),
        nullif(v_item->>'nib', ''),
        nullif(v_item->>'iban', ''),
        nullif(v_item->>'swift', ''),
        coalesce(nullif(v_item->>'currency', ''), 'MZN'),
        (v_index = v_default_index),
        coalesce((v_item->>'show_on_invoice')::boolean, true),
        v_index,
        nullif(v_item->>'document_path', ''),
        nullif(v_item->>'document_file_name', '')
      );
    END IF;
    v_index := v_index + 1;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.company_bank_accounts
    WHERE company_id = p_company_id
    ORDER BY is_default DESC, sort_order ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.save_company_bank_accounts(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_company_bank_accounts(uuid, jsonb) TO authenticated;

-- Migração dos dados: o banco único de cada empresa passa a ser a sua conta
-- por omissão. Só corre para empresas que ainda não têm contas na nova tabela,
-- por isso pode ser repetida sem duplicar linhas.
INSERT INTO public.company_bank_accounts (
  company_id, bank_name, account_number, iban, swift, nib,
  currency, is_default, show_on_invoice, sort_order
)
SELECT
  c.id,
  left(coalesce(nullif(trim(c.bank_name), ''), 'Banco'), 120),
  left(nullif(trim(c.bank_account), ''), 60),
  left(nullif(trim(c.bank_iban), ''), 40),
  left(nullif(trim(c.bank_swift), ''), 15),
  left(nullif(trim(c.nib), ''), 40),
  CASE WHEN c.currency ~ '^[A-Z]{3}$' THEN c.currency ELSE 'MZN' END,
  true,
  true,
  0
FROM public.companies c
WHERE coalesce(
        nullif(trim(c.bank_name), ''),
        nullif(trim(c.bank_account), ''),
        nullif(trim(c.bank_iban), ''),
        nullif(trim(c.bank_swift), ''),
        nullif(trim(c.nib), '')
      ) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.company_bank_accounts b WHERE b.company_id = c.id
  );

-- Colunas antigas mantidas por uma versão, para permitir verificar os dados
-- migrados. A aplicação deixa de as escrever e de as ler (salvo como recurso
-- quando a empresa ainda não tem contas na nova tabela).
COMMENT ON COLUMN public.companies.bank_name IS 'DEPRECATED – ver company_bank_accounts';
COMMENT ON COLUMN public.companies.bank_account IS 'DEPRECATED – ver company_bank_accounts';
COMMENT ON COLUMN public.companies.bank_iban IS 'DEPRECATED – ver company_bank_accounts';
COMMENT ON COLUMN public.companies.bank_swift IS 'DEPRECATED – ver company_bank_accounts';
COMMENT ON COLUMN public.companies.nib IS 'DEPRECATED – ver company_bank_accounts';

-- Armazenamento dos comprovativos bancários.
-- O bucket company-documents foi criado no painel e as suas políticas não estão
-- em migrações. As políticas abaixo são permissivas (somam-se às existentes) e
-- abrangem apenas os ficheiros <company_id>/bank_details_*: leitura para
-- membros da empresa, escrita para dono/administrador e super administrador.
-- A comparação é feita em texto para nunca falhar com caminhos que não sejam UUID.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('company-documents', 'company-documents', false)
  ON CONFLICT (id) DO NOTHING;

  DROP POLICY IF EXISTS "Company members can read bank documents" ON storage.objects;
  CREATE POLICY "Company members can read bank documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'bank_details\_%'
      AND (
        public.is_admin()
        OR EXISTS (
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

  DROP POLICY IF EXISTS "Company managers can upload bank documents" ON storage.objects;
  CREATE POLICY "Company managers can upload bank documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'bank_details\_%'
      AND (
        public.is_admin()
        OR EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
            AND cu.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id::text = (storage.foldername(name))[1]
            AND c.user_id = auth.uid()
        )
      )
    );

  DROP POLICY IF EXISTS "Company managers can update bank documents" ON storage.objects;
  CREATE POLICY "Company managers can update bank documents"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'bank_details\_%'
      AND (
        public.is_admin()
        OR EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
            AND cu.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM public.companies c
          WHERE c.id::text = (storage.foldername(name))[1]
            AND c.user_id = auth.uid()
        )
      )
    );

  DROP POLICY IF EXISTS "Company managers can delete bank documents" ON storage.objects;
  CREATE POLICY "Company managers can delete bank documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'company-documents'
      AND storage.filename(name) LIKE 'bank_details\_%'
      AND (
        public.is_admin()
        OR EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id::text = (storage.foldername(name))[1]
            AND cu.user_id = auth.uid()
            AND cu.role IN ('owner', 'admin')
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
    RAISE NOTICE 'Políticas de armazenamento dos comprovativos bancários não aplicadas (%). Configure-as no painel do Supabase.', SQLERRM;
END;
$$;
