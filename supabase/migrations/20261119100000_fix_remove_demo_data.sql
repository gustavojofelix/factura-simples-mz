-- Corrige remove_demo_data (20261118100000): a variável de ciclo "r" tinha o mesmo
-- nome que o alias da tabela invoices na verificação de documentos reais, e o
-- PL/pgSQL resolvia "r.related_invoice_id" como a variável (ainda por atribuir):
--   ERROR 55000: record "r" is not assigned yet
-- Resultado: "Remover dados de demonstração" falhava sempre. A variável passa a "rec".

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
  v_products int := 0;
  v_pos int := 0;
  rec record;
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

  -- Produtos, operadores, mesas, zonas e categorias demo: os que já foram usados
  -- em vendas reais ficam (como dados normais; os operadores ficam inactivos).
  FOR rec IN SELECT id FROM products WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM products WHERE id = rec.id
        AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.product_id = rec.id);
      IF FOUND THEN v_products := v_products + 1; END IF;
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
  END LOOP;
  UPDATE products SET is_demo = false WHERE company_id = p_company_id AND is_demo;

  DELETE FROM pos_operator_sessions o USING pos_staff s
   WHERE o.staff_id = s.id AND s.company_id = p_company_id AND s.is_demo;
  FOR rec IN SELECT id FROM pos_staff WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM pos_staff WHERE id = rec.id;
      v_pos := v_pos + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE pos_staff SET is_active = false, is_demo = false WHERE id = rec.id;
    END;
  END LOOP;

  FOR rec IN SELECT id FROM pos_tables WHERE company_id = p_company_id AND is_demo LOOP
    BEGIN
      DELETE FROM pos_tables WHERE id = rec.id;
      v_pos := v_pos + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE pos_tables SET is_demo = false WHERE id = rec.id;
    END;
  END LOOP;
  -- As mesas que ficarem perdem a zona (ON DELETE SET NULL).
  DELETE FROM pos_zones WHERE company_id = p_company_id AND is_demo;
  DELETE FROM product_categories WHERE company_id = p_company_id AND is_demo;

  -- Recibos emitidos sobre facturas demo: se não restar nenhum, a série recomeça.
  IF NOT EXISTS (SELECT 1 FROM payments WHERE company_id = p_company_id) THEN
    UPDATE companies SET receipt_next_number = 1 WHERE id = p_company_id;
  END IF;

  PERFORM set_config('app.demo_data', '', true);

  RETURN jsonb_build_object('invoices', v_invoices, 'clients', v_clients, 'products', v_products, 'pos', v_pos);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_demo_data(uuid) TO authenticated;
