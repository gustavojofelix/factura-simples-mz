/*
  Demonstração completa, limpeza total e marca de "factura de teste".

  1. Facturas criadas no período de teste (subscrição 'trialing') ficam marcadas
     com invoices.is_trial: a aplicação imprime-as com a marca de água
     "FACTURA DE TESTE". A marca é decidida pelo servidor quando a factura é
     criada (ou quando sai de rascunho) e não pode ser alterada pelo cliente.

  2. seed_demo_data passa também a preencher os dados da empresa (NUIT fictício,
     endereço, província, actividade e taxa), para que tudo funcione logo,
     incluindo o cálculo do ISPC, sem editar a empresa. A função anterior passa
     a chamar-se seed_demo_records (só clientes, produtos, facturas e POS).

  3. O ISPC volta a contar as facturas de demonstração: sem elas o imposto da
     demonstração dava sempre zero. Deixou de haver risco de irem parar a uma
     declaração real, porque remover a demonstração apaga tudo (ponto 4).

  4. remove_demo_data deixa de remover só os registos marcados como demo: apaga
     TUDO o que a empresa tem (facturas, recibos, clientes, produtos, POS,
     declarações de imposto) e repõe os dados da empresa em branco, com as
     séries de numeração a recomeçar no n.º 1. Ficam a empresa (nome, e-mail),
     os utilizadores, a subscrição, os terminais emparelhados e a auditoria.
     Só funciona enquanto a empresa tiver dados de demonstração.
*/

-- 1. Facturas do período de teste -------------------------------------------------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;

-- As facturas de demonstração já existentes também são de teste. Antes de criar
-- o trigger, que depois de emitida a factura já não deixa mudar a marca.
DROP TRIGGER IF EXISTS a_mark_trial_invoice ON public.invoices;
UPDATE public.invoices SET is_trial = true WHERE is_demo AND NOT is_trial;

CREATE OR REPLACE FUNCTION public.mark_trial_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Depois de emitida, a marca não muda.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'rascunho' THEN
    NEW.is_trial := OLD.is_trial;
    RETURN NEW;
  END IF;

  -- A mesma linha de subscrição que a aplicação mostra (a mais recente).
  NEW.is_trial := COALESCE((
    SELECT s.status = 'trialing'
      FROM subscriptions s
     WHERE s.company_id = NEW.company_id
     ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
     LIMIT 1
  ), false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_mark_trial_invoice ON public.invoices;
CREATE TRIGGER a_mark_trial_invoice
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.mark_trial_invoice();

-- 2. Carregar: também os dados da empresa -----------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.seed_demo_records(uuid, text)') IS NULL THEN
    ALTER FUNCTION public.seed_demo_data(uuid, text) RENAME TO seed_demo_records;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.seed_demo_records(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_company_id uuid, p_business_type text DEFAULT 'services')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
  v_nuit text;
BEGIN
  -- Valida o titular da conta e carrega clientes, produtos e facturas.
  v_result := public.seed_demo_records(p_company_id, p_business_type);
  IF NOT COALESCE((v_result ->> 'seeded')::boolean, false) THEN
    RETURN v_result;
  END IF;

  -- Dados da empresa: só se ainda não tiver NUIT (empresa acabada de criar).
  IF EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND COALESCE(nuit, '') = '') THEN
    -- NUIT fictício (começa por 99) que não colida com nenhuma empresa.
    LOOP
      v_nuit := '99' || lpad(floor(random() * 10000000)::int::text, 7, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE nuit = v_nuit);
    END LOOP;

    UPDATE companies
       SET nuit = v_nuit,
           entity_type = COALESCE(entity_type, 'singular'),
           address = COALESCE(NULLIF(address, ''), 'Av. 25 de Setembro, 1230, Maputo'),
           phone = COALESCE(NULLIF(phone, ''), '+258 84 000 0000'),
           postal_code = COALESCE(NULLIF(postal_code, ''), '1100'),
           documents_metadata = COALESCE(documents_metadata, '{}'::jsonb)
             || jsonb_build_object('province', 'Maputo', 'district', 'KaMpfumo'),
           category1 = 'comercial',
           category2 = 'comercio_geral',
           category3 = NULL,
           business_volume = '3'
     WHERE id = p_company_id;

    -- Actividades (catálogo configurável): comércio geral, taxa de 3%.
    INSERT INTO company_activities (company_id, activity_type_id, activity_role, is_primary)
    SELECT p_company_id, a.id, v.activity_role,
           v.is_primary AND NOT EXISTS (
             SELECT 1 FROM company_activities ca WHERE ca.company_id = p_company_id AND ca.is_primary)
      FROM (VALUES ('comercial', 'principal', true), ('comercio_geral', 'comercial', false))
           AS v(code, activity_role, is_primary)
      JOIN activity_types a ON a.code = v.code
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_result || jsonb_build_object('company_filled', v_nuit IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_data(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, text) TO authenticated;

-- 3. ISPC: as facturas de demonstração voltam a contar -----------------------------
-- Igual à versão de 20261118110000_ispc_calc_excludes_demo, sem "AND NOT i.is_demo"
-- (o cálculo no cliente, tax.service.ts, deixou de as excluir na mesma altura).
CREATE OR REPLACE FUNCTION public.calculate_ispc_for_period(
  p_company_id uuid,
  p_start_date date,
  p_end_date date,
  p_base_rate numeric DEFAULT 3,
  p_is_scale_activity boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period_sales numeric(14,2);
  v_annual_before numeric(14,2);
  v_annual_to_date numeric(14,2);
  v_tax numeric(14,2);
BEGIN
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Período fiscal inválido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = p_company_id
      AND (
        c.user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.company_users cu
          WHERE cu.company_id = c.id
            AND cu.user_id = auth.uid()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Sem acesso à empresa';
  END IF;

  SELECT COALESCE(SUM(i.total), 0)::numeric(14,2)
  INTO v_period_sales
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.status NOT IN ('rascunho', 'anulada')
    AND i.date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(SUM(i.total), 0)::numeric(14,2)
  INTO v_annual_before
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.status NOT IN ('rascunho', 'anulada')
    AND i.date >= make_date(EXTRACT(YEAR FROM p_start_date)::integer, 1, 1)
    AND i.date < p_start_date;

  SELECT COALESCE(SUM(i.total), 0)::numeric(14,2)
  INTO v_annual_to_date
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.status NOT IN ('rascunho', 'anulada')
    AND i.date >= make_date(EXTRACT(YEAR FROM p_start_date)::integer, 1, 1)
    AND i.date <= p_end_date;

  SELECT COALESCE(SUM(x.total_tax), 0)::numeric(14,2)
  INTO v_tax
  FROM public.calculate_ispc_split(
    v_period_sales,
    v_annual_before,
    p_base_rate::integer
  ) x;

  RETURN jsonb_build_object(
    'period_sales', v_period_sales,
    'annual_sales_before_period', v_annual_before,
    'annual_sales', v_annual_to_date,
    'tax', v_tax,
    'is_scale_activity', p_is_scale_activity
  );
END;
$$;

-- 4. Remover: apaga tudo e repõe a empresa em branco -------------------------------
CREATE OR REPLACE FUNCTION public.remove_demo_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_invoices int := 0;
  v_clients int := 0;
  v_products int := 0;
  v_n int;
BEGIN
  SELECT account_id INTO v_account FROM companies WHERE id = p_company_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_account_owner(v_account) THEN
    RAISE EXCEPTION 'Só o titular da conta pode remover os dados de demonstração' USING ERRCODE = '42501';
  END IF;

  -- Só uma empresa em demonstração pode ser limpa: sem dados demo, esta função
  -- apagaria os documentos fiscais de uma empresa real.
  IF NOT EXISTS (SELECT 1 FROM clients WHERE company_id = p_company_id AND is_demo)
     AND NOT EXISTS (SELECT 1 FROM invoices WHERE company_id = p_company_id AND is_demo) THEN
    RAISE EXCEPTION 'Esta empresa não tem dados de demonstração.'
      USING ERRCODE = 'P0001', DETAIL = 'NO_DEMO_DATA';
  END IF;

  -- POS: movimentos e pedidos (referem facturas, sessões e operadores).
  DELETE FROM pos_payments         WHERE company_id = p_company_id;
  DELETE FROM pos_payment_requests WHERE company_id = p_company_id;
  DELETE FROM pos_authorizations   WHERE company_id = p_company_id;
  DELETE FROM pos_cash_movements   WHERE company_id = p_company_id;
  DELETE FROM pos_order_lines      WHERE company_id = p_company_id;
  DELETE FROM pos_orders           WHERE company_id = p_company_id;

  -- Facturas: primeiro as que referem outra (notas de crédito), depois o resto.
  -- As linhas e os recibos caem em cascata.
  DELETE FROM invoices WHERE company_id = p_company_id AND related_invoice_id IS NOT NULL;
  GET DIAGNOSTICS v_invoices = ROW_COUNT;
  DELETE FROM invoices WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_invoices := v_invoices + v_n;

  -- POS: sessões, operadores, mesas e zonas (os terminais emparelhados ficam).
  DELETE FROM pos_sessions          WHERE company_id = p_company_id;
  DELETE FROM pos_operator_sessions WHERE company_id = p_company_id;
  DELETE FROM pos_staff             WHERE company_id = p_company_id;
  DELETE FROM pos_tables            WHERE company_id = p_company_id;
  DELETE FROM pos_zones             WHERE company_id = p_company_id;

  DELETE FROM clients WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  -- Os movimentos de stock caem em cascata com os produtos.
  DELETE FROM products WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;
  DELETE FROM product_categories WHERE company_id = p_company_id;

  -- Impostos (os pagamentos caem em cascata), lembretes e alertas.
  DELETE FROM tax_declarations WHERE company_id = p_company_id;
  DELETE FROM tax_reminders    WHERE company_id = p_company_id;
  DELETE FROM ai_alerts        WHERE company_id = p_company_id;

  -- Configuração da empresa.
  DELETE FROM company_activities    WHERE company_id = p_company_id;
  DELETE FROM company_bank_accounts WHERE company_id = p_company_id;
  DELETE FROM company_documents     WHERE company_id = p_company_id;
  DELETE FROM document_series       WHERE company_id = p_company_id;

  -- Fica como uma empresa acabada de criar: só o nome e o e-mail.
  UPDATE companies
     SET nuit = '',
         entity_type = 'singular',
         address = '',
         phone = NULL,
         postal_code = NULL,
         documents_metadata = '{}'::jsonb,
         category1 = NULL,
         category2 = NULL,
         category3 = NULL,
         business_volume = '3',
         logo_url = NULL,
         nuit_document_url = NULL,
         commercial_activity_document_url = NULL,
         bank_name = NULL,
         bank_account = NULL,
         bank_iban = NULL,
         bank_swift = NULL,
         nib = NULL,
         mpesa_number = NULL,
         emola_number = NULL,
         invoice_number = 1,
         receipt_next_number = 1,
         pos_trial = false,
         pos_settings = '{}'::jsonb
   WHERE id = p_company_id;

  RETURN jsonb_build_object('reset', true, 'invoices', v_invoices, 'clients', v_clients, 'products', v_products);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_demo_data(uuid) TO authenticated;
