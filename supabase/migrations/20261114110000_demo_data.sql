-- =============================================================================
-- Dados de demonstração para o período de teste
--
-- Quem se regista pode carregar clientes, produtos e facturas de exemplo para
-- experimentar a aplicação sem preparar nada. Os registos ficam marcados com
-- `is_demo` e são removidos de uma só vez (remove_demo_data).
--
-- 1. `is_demo` em clients, products e invoices.
--    - Só o seed_demo_data o pode pôr a true (GUC app.demo_data na transacção);
--      num INSERT/UPDATE normal o trigger a_guard_demo_flag repõe o valor.
--      Assim ninguém marca uma factura real como demo para depois a apagar.
-- 2. As facturas demo:
--    - têm número próprio (DEMO 00001, ...): não consomem a série fiscal FAC;
--    - não contam para os limites do plano (facturas/mês, clientes, produtos).
-- 3. seed_demo_data(company) / remove_demo_data(company): só o titular da conta.
--    - remove_demo_data mantém (e passa a reais) os clientes demo que já
--      tenham facturas reais, e os produtos demo usados em facturas reais.
-- =============================================================================

-- 1. Colunas -----------------------------------------------------------------
ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_demo  ON public.clients (company_id)  WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_products_demo ON public.products (company_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_invoices_demo ON public.invoices (company_id) WHERE is_demo;

-- 2. Protecção da marca ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_demo_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.demo_data', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_demo := false;
  ELSE
    NEW.is_demo := OLD.is_demo;
  END IF;
  RETURN NEW;
END;
$$;

-- O prefixo "a_" faz com que corra antes dos restantes triggers BEFORE
-- (numeração e limites), que já vêem o valor corrigido.
DROP TRIGGER IF EXISTS a_guard_demo_flag ON public.clients;
CREATE TRIGGER a_guard_demo_flag
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_demo_flag();

DROP TRIGGER IF EXISTS a_guard_demo_flag ON public.products;
CREATE TRIGGER a_guard_demo_flag
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_demo_flag();

DROP TRIGGER IF EXISTS a_guard_demo_flag ON public.invoices;
CREATE TRIGGER a_guard_demo_flag
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_demo_flag();

-- 3. Numeração: as facturas demo mantêm o número que trazem ----------------------
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rascunho' THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.invoice_number, '') = '' THEN
      NEW.invoice_number := 'RSC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR OLD.status = 'rascunho' THEN
    NEW.invoice_number := public.next_document_number(NEW.company_id, NEW.document_type, NEW.date);
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Limites do plano: os dados demo não contam ----------------------------------
CREATE OR REPLACE FUNCTION public.enforce_resource_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint; v_code text;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW;
  END IF;
  -- IF aninhado: NEW.is_walk_in só existe em clients.
  IF TG_TABLE_NAME = 'clients' THEN
    IF NEW.is_walk_in THEN
      RETURN NEW;
    END IF;
  END IF;
  v_code := CASE TG_TABLE_NAME WHEN 'clients' THEN 'max_clients' ELSE 'max_products' END;
  v_count := CASE TG_TABLE_NAME
    WHEN 'clients' THEN (SELECT count(*) FROM public.clients WHERE company_id = NEW.company_id AND NOT is_walk_in AND NOT is_demo)
    ELSE (SELECT count(*) FROM public.products WHERE company_id = NEW.company_id AND NOT is_demo)
  END;
  PERFORM public.assert_subscription_limit(NEW.company_id, v_code, v_count, 1);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_invoice_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.status IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;
  IF NEW.document_type = 'NC' THEN RETURN NEW; END IF;
  -- O POS está só nos planos sem limite de facturas e é controlado por
  -- company_pos_access (incluindo a tolerância, em que o plano em vigor
  -- passaria a ser o Trial).
  IF NEW.origin = 'pos' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;

  PERFORM public.assert_subscription_feature(NEW.company_id, 'invoicing');

  v_count := (
    SELECT count(*) FROM public.invoices i
     WHERE i.company_id = NEW.company_id
       AND i.status NOT IN ('rascunho', 'anulada')
       AND i.document_type <> 'NC'
       AND NOT i.is_demo
       AND i.date >= date_trunc('month', CURRENT_DATE)::date
       AND i.date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
  );
  PERFORM public.assert_subscription_limit(NEW.company_id, 'max_invoices_month', v_count, 1);
  RETURN NEW;
END;
$$;

-- 5. Carregar -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_uid uuid := auth.uid();
  c_mercearia uuid; c_construtora uuid; c_ana uuid; c_escola uuid; c_transportes uuid;
  p_cimento uuid; p_papel uuid; p_agua uuid; p_consultoria uuid; p_instalacao uuid; p_transporte uuid;
  v_inv uuid;
  v_seq int := 0;
  r record;
BEGIN
  SELECT account_id INTO v_account FROM companies WHERE id = p_company_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_account_owner(v_account) THEN
    RAISE EXCEPTION 'Só o titular da conta pode carregar dados de demonstração' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: não duplica se já houver dados demo.
  IF EXISTS (SELECT 1 FROM clients WHERE company_id = p_company_id AND is_demo)
     OR EXISTS (SELECT 1 FROM products WHERE company_id = p_company_id AND is_demo) THEN
    RETURN jsonb_build_object('seeded', false);
  END IF;

  PERFORM set_config('app.demo_data', 'on', true);

  -- Clientes
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Mercearia Esperança, Lda', '400100201', '+258 84 100 2001', 'compras@mercearia-esperanca.example', 'Av. Eduardo Mondlane, 1200, Maputo', true, true)
  RETURNING id INTO c_mercearia;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Construtora Horizonte, Lda', '400100202', '+258 82 100 2002', 'financeiro@horizonte.example', 'Rua da Beira, 45, Matola', true, true)
  RETURNING id INTO c_construtora;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Ana Machava', '100100203', '+258 86 100 2003', 'ana.machava@example.com', 'Bairro Central, Maputo', true, true)
  RETURNING id INTO c_ana;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Escola Primária Luz do Saber', '500100204', '+258 84 100 2004', 'direccao@luzdosaber.example', 'Av. Julius Nyerere, 300, Maputo', true, true)
  RETURNING id INTO c_escola;
  INSERT INTO clients (company_id, name, nuit, phone, email, address, is_active, is_demo)
  VALUES (p_company_id, 'Transportes Rápido Sul, Lda', '400100205', '+258 87 100 2005', 'geral@rapidosul.example', 'EN4, Km 12, Boane', true, true)
  RETURNING id INTO c_transportes;

  -- Produtos e serviços (stock já descontado das vendas abaixo)
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Saco de cimento 50 kg', 'Cimento Portland', 650, 'produto', 'un', 140, true, true)
  RETURNING id INTO p_cimento;
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Resma de papel A4', '500 folhas, 80 g', 380, 'produto', 'un', 50, true, true)
  RETURNING id INTO p_papel;
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Água mineral 1,5 L (caixa de 6)', NULL, 420, 'produto', 'cx', 25, true, true)
  RETURNING id INTO p_agua;
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Consultoria (hora)', 'Apoio técnico e administrativo', 2500, 'servico', 'h', NULL, true, true)
  RETURNING id INTO p_consultoria;
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Instalação e manutenção', NULL, 4500, 'servico', 'un', NULL, true, true)
  RETURNING id INTO p_instalacao;
  INSERT INTO products (company_id, name, description, price, type, unit, stock, is_active, is_demo)
  VALUES (p_company_id, 'Transporte e entrega', NULL, 1200, 'servico', 'un', NULL, true, true)
  RETURNING id INTO p_transporte;

  -- Facturas: (dias atrás, prazo em dias, cliente, pago?, linhas[produto, nome, qtd, preço])
  FOR r IN
    SELECT * FROM (VALUES
      (45, 15, c_construtora, true,  jsonb_build_array(jsonb_build_array(p_cimento, 'Saco de cimento 50 kg', 40, 650))),
      (30, 15, c_mercearia,   true,  jsonb_build_array(jsonb_build_array(p_papel, 'Resma de papel A4', 10, 380),
                                                       jsonb_build_array(p_agua, 'Água mineral 1,5 L (caixa de 6)', 5, 420))),
      (20, 15, c_escola,      false, jsonb_build_array(jsonb_build_array(p_consultoria, 'Consultoria (hora)', 4, 2500))),
      (12, 15, c_ana,         true,  jsonb_build_array(jsonb_build_array(p_instalacao, 'Instalação e manutenção', 1, 4500),
                                                       jsonb_build_array(p_transporte, 'Transporte e entrega', 1, 1200))),
      (5,  30, c_transportes, false, jsonb_build_array(jsonb_build_array(p_agua, 'Água mineral 1,5 L (caixa de 6)', 10, 420))),
      (1,  30, c_construtora, false, jsonb_build_array(jsonb_build_array(p_cimento, 'Saco de cimento 50 kg', 20, 650),
                                                       jsonb_build_array(p_transporte, 'Transporte e entrega', 1, 1200)))
    ) AS t(days_ago, term, client_id, paid, lines)
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO invoices (
      company_id, client_id, invoice_number, date, due_date,
      subtotal, total, amount_paid, amount_pending, status, payment_date,
      document_type, origin, notes, created_by, issued_at, is_demo
    )
    SELECT
      p_company_id, r.client_id,
      'DEMO ' || lpad(v_seq::text, 5, '0'),
      CURRENT_DATE - r.days_ago,
      CURRENT_DATE - r.days_ago + r.term,
      tot, tot,
      CASE WHEN r.paid THEN tot ELSE 0 END,
      CASE WHEN r.paid THEN 0 ELSE tot END,
      CASE WHEN r.paid THEN 'paga'
           WHEN CURRENT_DATE - r.days_ago + r.term < CURRENT_DATE THEN 'vencida'
           ELSE 'pendente' END,
      CASE WHEN r.paid THEN CURRENT_DATE - r.days_ago + 3 END,
      'FT', 'app', 'Factura de demonstração', v_uid,
      (CURRENT_DATE - r.days_ago)::timestamptz + interval '10 hours',
      true
    FROM (
      SELECT sum((l->>2)::numeric * (l->>3)::numeric) AS tot
        FROM jsonb_array_elements(r.lines) l
    ) s
    RETURNING id INTO v_inv;

    INSERT INTO invoice_items (invoice_id, product_id, product_name, description, quantity, unit_price, subtotal, total)
    SELECT v_inv, (l->>0)::uuid, l->>1, l->>1, (l->>2)::numeric, (l->>3)::numeric,
           (l->>2)::numeric * (l->>3)::numeric, (l->>2)::numeric * (l->>3)::numeric
      FROM jsonb_array_elements(r.lines) l;
  END LOOP;

  PERFORM set_config('app.demo_data', '', true);

  RETURN jsonb_build_object('seeded', true, 'clients', 5, 'products', 6, 'invoices', v_seq);
END;
$$;

-- 6. Remover --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_demo_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_invoices int;
  v_clients int;
  v_products int;
BEGIN
  SELECT account_id INTO v_account FROM companies WHERE id = p_company_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_account_owner(v_account) THEN
    RAISE EXCEPTION 'Só o titular da conta pode remover os dados de demonstração' USING ERRCODE = '42501';
  END IF;

  -- Documentos reais (ex.: notas de crédito) ligados a facturas demo.
  IF EXISTS (
    SELECT 1 FROM invoices r
      JOIN invoices d ON d.id = r.related_invoice_id
     WHERE d.company_id = p_company_id AND d.is_demo AND NOT r.is_demo
  ) THEN
    RAISE EXCEPTION 'Há documentos reais associados a facturas de demonstração; não é possível removê-las.'
      USING ERRCODE = 'P0001', DETAIL = 'DEMO_DATA_IN_USE';
  END IF;

  PERFORM set_config('app.demo_data', 'on', true);

  -- Os pagamentos e as linhas caem em cascata.
  DELETE FROM invoices WHERE company_id = p_company_id AND is_demo;
  GET DIAGNOSTICS v_invoices = ROW_COUNT;

  -- Clientes demo já usados em facturas reais ficam (como clientes normais).
  DELETE FROM clients c
   WHERE c.company_id = p_company_id AND c.is_demo
     AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.id);
  GET DIAGNOSTICS v_clients = ROW_COUNT;
  UPDATE clients SET is_demo = false WHERE company_id = p_company_id AND is_demo;

  DELETE FROM products p
   WHERE p.company_id = p_company_id AND p.is_demo
     AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id);
  GET DIAGNOSTICS v_products = ROW_COUNT;
  UPDATE products SET is_demo = false WHERE company_id = p_company_id AND is_demo;

  -- Recibos emitidos sobre facturas demo: se não restar nenhum, a série recomeça.
  IF NOT EXISTS (SELECT 1 FROM payments WHERE company_id = p_company_id) THEN
    UPDATE companies SET receipt_next_number = 1 WHERE id = p_company_id;
  END IF;

  PERFORM set_config('app.demo_data', '', true);

  RETURN jsonb_build_object('invoices', v_invoices, 'clients', v_clients, 'products', v_products);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_demo_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_demo_data(uuid) TO authenticated;
