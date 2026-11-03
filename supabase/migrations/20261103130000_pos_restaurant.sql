/*
  # Ponto de Venda — Fase 4: restaurante

  Pedidos de mesa guardados no servidor, partilhados em tempo real entre os
  terminais (caixa e telemóveis dos empregados, via Supabase Realtime).

  1. `pos_orders`: um pedido aberto por mesa. A mesa é a referência da conta;
     a FR é emitida para o Consumidor final ou para o NUIT pedido, com a mesa
     no documento.
  2. `pos_order_lines`: estado pending (por enviar) → sent (na cozinha/bar).
     Reduzir ou retirar uma linha já enviada exige motivo e permissão de
     gerente, e gera um talão "ANULADO" para a estação. A parte anulada fica
     registada numa linha 'voided'.
  3. Conta dividida: `pos_checkout_order` cobra todas as linhas por pagar ou
     só as quantidades indicadas (uma FR por parte). O pedido fecha quando
     tudo está pago.
  4. A caixa não fecha com pedidos abertos.
*/

CREATE TABLE IF NOT EXISTS public.pos_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  table_id uuid REFERENCES public.pos_tables(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  waiter_id uuid REFERENCES public.pos_staff(id),
  covers integer NOT NULL DEFAULT 1 CHECK (covers BETWEEN 1 AND 99),
  notes text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  cancel_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_orders_one_open_per_table
  ON public.pos_orders (table_id) WHERE status = 'open' AND table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_company_open ON public.pos_orders (company_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.pos_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.pos_orders(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  paid_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0),
  station text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'voided')),
  sent_at timestamptz,
  created_by uuid REFERENCES public.pos_staff(id),
  voided_by uuid REFERENCES public.pos_staff(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_order_lines_order ON public.pos_order_lines (order_id);

ALTER TABLE public.pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_order_lines ENABLE ROW LEVEL SECURITY;

-- Leitura para gerentes (aplicação) e para os terminais da empresa (Realtime).
-- As escritas são só pelas funções pos_*.
CREATE OR REPLACE FUNCTION public.pos_terminal_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.pos_terminals
   WHERE auth_user_id = auth.uid() AND revoked_at IS NULL
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.pos_terminal_company_id() TO authenticated;

DROP POLICY IF EXISTS "View orders" ON public.pos_orders;
CREATE POLICY "View orders" ON public.pos_orders
  FOR SELECT TO authenticated
  USING (company_id = public.pos_terminal_company_id() OR public.pos_is_manager(company_id));

DROP POLICY IF EXISTS "View order lines" ON public.pos_order_lines;
CREATE POLICY "View order lines" ON public.pos_order_lines
  FOR SELECT TO authenticated
  USING (company_id = public.pos_terminal_company_id() OR public.pos_is_manager(company_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'pos_orders') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_orders;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'pos_order_lines') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_order_lines;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._pos_open_orders_count(p_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM public.pos_orders WHERE company_id = p_company_id AND status = 'open';
$$;

-- ---------------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pos_order_json(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'table_id', o.table_id, 'table_name', t.name, 'status', o.status,
    'covers', o.covers, 'notes', o.notes, 'opened_at', o.opened_at, 'updated_at', o.updated_at,
    'waiter_id', o.waiter_id, 'waiter', w.name, 'waiter_color', w.color,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'product_id', l.product_id, 'name', l.product_name, 'unit_price', l.unit_price,
               'quantity', l.quantity, 'paid_quantity', l.paid_quantity, 'station', l.station,
               'notes', l.notes, 'status', l.status, 'sent_at', l.sent_at, 'void_reason', l.void_reason)
             ORDER BY l.created_at, l.id)
        FROM pos_order_lines l WHERE l.order_id = o.id
    ), '[]'::jsonb),
    'total', COALESCE((
      SELECT sum(public._pos_round(l.unit_price * l.quantity)) FROM pos_order_lines l
       WHERE l.order_id = o.id AND l.status <> 'voided'
    ), 0),
    'due', COALESCE((
      SELECT sum(public._pos_round(l.unit_price * (l.quantity - l.paid_quantity))) FROM pos_order_lines l
       WHERE l.order_id = o.id AND l.status <> 'voided'
    ), 0),
    'unsent', (SELECT count(*) FROM pos_order_lines l WHERE l.order_id = o.id AND l.status = 'pending')
  )
  FROM pos_orders o
  LEFT JOIN pos_tables t ON t.id = o.table_id
  LEFT JOIN pos_staff w ON w.id = o.waiter_id
  WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public._pos_order_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_list_orders(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(public._pos_order_json(o.id) ORDER BY o.opened_at)
      FROM pos_orders o WHERE o.company_id = c.company_id AND o.status = 'open'
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_list_orders(text) TO authenticated;

-- Pedido aberto do terminal, validado e bloqueado para escrita.
CREATE OR REPLACE FUNCTION public._pos_lock_order(p_company_id uuid, p_order_id uuid)
RETURNS public.pos_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order pos_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM pos_orders WHERE id = p_order_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'open' THEN
    RAISE EXCEPTION 'Este pedido já foi fechado.' USING ERRCODE = 'P0001', DETAIL = 'POS_ORDER_CLOSED';
  END IF;
  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public._pos_lock_order(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Abrir, adicionar, alterar, enviar, mudar de mesa, cancelar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_open_order(p_token text, p_table_id uuid, p_covers integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);

  IF NOT EXISTS (SELECT 1 FROM pos_tables WHERE id = p_table_id AND company_id = c.company_id AND is_active) THEN
    RAISE EXCEPTION 'Mesa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_id FROM pos_orders WHERE table_id = p_table_id AND status = 'open';
  IF v_id IS NULL THEN
    INSERT INTO pos_orders (company_id, table_id, waiter_id, covers)
    VALUES (c.company_id, p_table_id, c.staff_id, LEAST(GREATEST(COALESCE(p_covers, 1), 1), 99))
    ON CONFLICT (table_id) WHERE status = 'open' AND table_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM pos_orders WHERE table_id = p_table_id AND status = 'open';
    END IF;
  END IF;

  RETURN public._pos_order_json(v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_open_order(text, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_order_add_line(
  p_token text,
  p_order_id uuid,
  p_product_id uuid,
  p_quantity numeric DEFAULT 1,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
  v_product products%ROWTYPE;
  v_qty numeric := round(COALESCE(p_quantity, 1), 3);
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_line uuid;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);
  v_order := public._pos_lock_order(c.company_id, p_order_id);

  SELECT * INTO v_product FROM products
   WHERE id = p_product_id AND company_id = c.company_id AND COALESCE(is_active, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_product.pos_available THEN
    RAISE EXCEPTION '% está esgotado hoje.', v_product.name USING ERRCODE = 'P0001', DETAIL = 'POS_UNAVAILABLE';
  END IF;
  IF v_qty <= 0 OR (NOT v_product.sold_by_weight AND v_qty <> trunc(v_qty)) THEN
    RAISE EXCEPTION 'Quantidade inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_line FROM pos_order_lines
   WHERE order_id = v_order.id AND product_id = v_product.id AND status = 'pending'
     AND paid_quantity = 0 AND notes IS NOT DISTINCT FROM v_notes
   LIMIT 1;

  IF v_line IS NOT NULL THEN
    UPDATE pos_order_lines SET quantity = quantity + v_qty WHERE id = v_line;
  ELSE
    INSERT INTO pos_order_lines (order_id, company_id, product_id, product_name, unit_price, quantity,
                                 station, notes, created_by)
    VALUES (v_order.id, c.company_id, v_product.id, v_product.name, v_product.price, v_qty,
            v_product.pos_station, v_notes, c.staff_id);
  END IF;

  UPDATE pos_orders SET updated_at = now() WHERE id = v_order.id;
  RETURN public._pos_order_json(v_order.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_add_line(text, uuid, uuid, numeric, text) TO authenticated;

/*
  Muda a quantidade (0 = retirar) ou a nota de uma linha.
  - Linha por enviar: livre.
  - Linha enviada: só se pode reduzir, com motivo e permissão 'void_sent_line'
    (PIN de gerente). A parte retirada passa a uma linha 'voided' e é devolvido
    o talão de anulação para a estação.
  - Nunca abaixo do que já foi pago.
*/
CREATE OR REPLACE FUNCTION public.pos_order_update_line(
  p_token text,
  p_line_id uuid,
  p_quantity numeric,
  p_notes text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_auth_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_line pos_order_lines%ROWTYPE;
  v_order pos_orders%ROWTYPE;
  v_qty numeric := round(COALESCE(p_quantity, 0), 3);
  v_removed numeric;
  v_auth uuid;
  v_ticket jsonb;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);

  SELECT * INTO v_line FROM pos_order_lines WHERE id = p_line_id AND company_id = c.company_id;
  IF NOT FOUND OR v_line.status = 'voided' THEN
    RAISE EXCEPTION 'Linha não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  v_order := public._pos_lock_order(c.company_id, v_line.order_id);
  SELECT * INTO v_line FROM pos_order_lines WHERE id = p_line_id FOR UPDATE;

  IF v_qty < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_qty < v_line.paid_quantity THEN
    RAISE EXCEPTION 'Já foram pagas % unidades desta linha.', v_line.paid_quantity USING ERRCODE = '22023';
  END IF;

  IF v_line.status = 'pending' THEN
    IF v_qty = 0 THEN
      DELETE FROM pos_order_lines WHERE id = v_line.id;
    ELSE
      UPDATE pos_order_lines
         SET quantity = v_qty,
             notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END
       WHERE id = v_line.id;
    END IF;
  ELSE
    IF v_qty > v_line.quantity THEN
      RAISE EXCEPTION 'Para mais quantidade, adicione uma nova linha.' USING ERRCODE = '22023';
    END IF;
    IF v_qty = v_line.quantity THEN
      -- Mesma quantidade numa linha enviada: nada muda (a cozinha já tem o talão).
      RETURN jsonb_build_object('order', public._pos_order_json(v_order.id));
    END IF;
    IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Indique o motivo da anulação.' USING ERRCODE = 'P0001', DETAIL = 'POS_REASON_REQUIRED';
    END IF;
    v_removed := v_line.quantity - v_qty;
    v_auth := public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                  'void_sent_line', p_auth_pin,
                                  jsonb_build_object('product', v_line.product_name, 'quantity', v_removed,
                                                     'reason', p_reason, 'order_id', v_order.id));
    IF v_qty = 0 THEN
      UPDATE pos_order_lines
         SET status = 'voided', voided_by = v_auth, void_reason = left(btrim(p_reason), 200)
       WHERE id = v_line.id;
    ELSE
      UPDATE pos_order_lines SET quantity = v_qty WHERE id = v_line.id;
      INSERT INTO pos_order_lines (order_id, company_id, product_id, product_name, unit_price, quantity, station,
                                   notes, status, sent_at, created_by, voided_by, void_reason)
      VALUES (v_line.order_id, v_line.company_id, v_line.product_id, v_line.product_name, v_line.unit_price,
              v_removed, v_line.station, v_line.notes, 'voided', v_line.sent_at, v_line.created_by, v_auth,
              left(btrim(p_reason), 200));
    END IF;

    v_ticket := jsonb_build_object(
      'station', v_line.station, 'table_name', (SELECT name FROM pos_tables WHERE id = v_order.table_id),
      'waiter', c.staff_name, 'product', v_line.product_name, 'quantity', v_removed,
      'reason', btrim(p_reason), 'authorized_by', (SELECT name FROM pos_staff WHERE id = v_auth),
      'at', now());

    PERFORM public._pos_audit(c.company_id, 'POS: Anulou linha enviada', v_order.id, v_line.product_name,
      v_ticket);
  END IF;

  UPDATE pos_orders SET updated_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('order', public._pos_order_json(v_order.id), 'void_ticket', v_ticket);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_update_line(text, uuid, numeric, text, text, text) TO authenticated;

-- Envia as linhas por enviar e devolve os talões por estação.
CREATE OR REPLACE FUNCTION public.pos_order_send(p_token text, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
  v_tickets jsonb;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);
  v_order := public._pos_lock_order(c.company_id, p_order_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('station', x.station, 'lines', x.lines)), '[]'::jsonb)
    INTO v_tickets
    FROM (
      SELECT l.station,
             jsonb_agg(jsonb_build_object('name', l.product_name, 'quantity', l.quantity, 'notes', l.notes)
                       ORDER BY l.created_at) AS lines
        FROM pos_order_lines l
       WHERE l.order_id = v_order.id AND l.status = 'pending' AND l.station IS NOT NULL
       GROUP BY l.station
    ) x;

  UPDATE pos_order_lines SET status = 'sent', sent_at = now()
   WHERE order_id = v_order.id AND status = 'pending';
  UPDATE pos_orders SET updated_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order', public._pos_order_json(v_order.id),
    'tickets', v_tickets,
    'table_name', (SELECT name FROM pos_tables WHERE id = v_order.table_id),
    'covers', v_order.covers,
    'waiter', c.staff_name,
    'at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_send(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_order_move(p_token text, p_order_id uuid, p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);
  v_order := public._pos_lock_order(c.company_id, p_order_id);

  IF NOT EXISTS (SELECT 1 FROM pos_tables WHERE id = p_table_id AND company_id = c.company_id AND is_active) THEN
    RAISE EXCEPTION 'Mesa não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_orders WHERE table_id = p_table_id AND status = 'open') THEN
    RAISE EXCEPTION 'A mesa de destino está ocupada.' USING ERRCODE = 'P0001', DETAIL = 'POS_TABLE_BUSY';
  END IF;

  UPDATE pos_orders SET table_id = p_table_id, updated_at = now() WHERE id = v_order.id;
  PERFORM public._pos_audit(c.company_id, 'POS: Mudou pedido de mesa', v_order.id,
    (SELECT name FROM pos_tables WHERE id = p_table_id),
    jsonb_build_object('from', (SELECT name FROM pos_tables WHERE id = v_order.table_id), 'staff', c.staff_name));
  RETURN public._pos_order_json(v_order.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_move(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_order_set_covers(p_token text, p_order_id uuid, p_covers integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);
  v_order := public._pos_lock_order(c.company_id, p_order_id);
  UPDATE pos_orders SET covers = LEAST(GREATEST(COALESCE(p_covers, 1), 1), 99), updated_at = now()
   WHERE id = v_order.id;
  RETURN public._pos_order_json(v_order.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_set_covers(text, uuid, integer) TO authenticated;

-- Fecha um pedido sem cobrar: livre se nada foi enviado nem pago; senão exige gerente.
CREATE OR REPLACE FUNCTION public.pos_order_cancel(p_token text, p_order_id uuid, p_reason text DEFAULT NULL, p_auth_pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);
  PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions, 'orders', NULL);
  v_order := public._pos_lock_order(c.company_id, p_order_id);

  IF EXISTS (SELECT 1 FROM pos_order_lines WHERE order_id = v_order.id AND paid_quantity > 0) THEN
    RAISE EXCEPTION 'Este pedido já tem partes pagas. Cobre o restante ou anule as linhas.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM pos_order_lines WHERE order_id = v_order.id AND status = 'sent') THEN
    IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Indique o motivo da anulação.' USING ERRCODE = 'P0001', DETAIL = 'POS_REASON_REQUIRED';
    END IF;
    PERFORM public._pos_require(c.company_id, c.terminal_id, c.staff_id, c.staff_role, c.staff_permissions,
                                'void_sent_line', p_auth_pin,
                                jsonb_build_object('order_id', v_order.id, 'reason', p_reason, 'cancel_order', true));
    UPDATE pos_order_lines SET status = 'voided', void_reason = left(btrim(p_reason), 200)
     WHERE order_id = v_order.id AND status = 'sent';
  END IF;

  DELETE FROM pos_order_lines WHERE order_id = v_order.id AND status = 'pending';
  UPDATE pos_orders SET status = 'cancelled', closed_at = now(), cancel_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         updated_at = now()
   WHERE id = v_order.id;

  PERFORM public._pos_audit(c.company_id, 'POS: Cancelou pedido de mesa', v_order.id,
    (SELECT name FROM pos_tables WHERE id = v_order.table_id), jsonb_build_object('reason', p_reason, 'staff', c.staff_name));
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_order_cancel(text, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cobrar (conta completa ou dividida)
-- ---------------------------------------------------------------------------
/*
  p_payload como em pos_issue_fr, sem "lines", mais opcionalmente
  "order_lines": [{"line_id": "…", "quantity": 1}] para dividir a conta.
  Sem order_lines cobra tudo o que falta pagar. Linhas por enviar também
  podem ser cobradas (ex.: bebidas servidas ao balcão).
*/
CREATE OR REPLACE FUNCTION public.pos_checkout_order(
  p_token text,
  p_order_id uuid,
  p_payload jsonb,
  p_auth_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_order pos_orders%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_pick jsonb;
  v_line pos_order_lines%ROWTYPE;
  v_qty numeric;
  v_payload jsonb;
  v_client_uuid uuid := NULLIF(p_payload ->> 'client_uuid', '')::uuid;
  v_existing boolean := false;
  v_invoice uuid;
  v_doc jsonb;
  v_closed boolean := false;
BEGIN
  SELECT * INTO c FROM public._pos_ctx(p_token);

  IF v_client_uuid IS NOT NULL AND EXISTS (
    SELECT 1 FROM invoices WHERE company_id = c.company_id AND pos_client_uuid = v_client_uuid
  ) THEN
    v_existing := true;
  END IF;

  IF NOT v_existing THEN
    v_order := public._pos_lock_order(c.company_id, p_order_id);

    IF jsonb_typeof(p_payload -> 'order_lines') = 'array' AND jsonb_array_length(p_payload -> 'order_lines') > 0 THEN
      FOR v_pick IN SELECT * FROM jsonb_array_elements(p_payload -> 'order_lines') LOOP
        SELECT * INTO v_line FROM pos_order_lines
         WHERE id = (v_pick ->> 'line_id')::uuid AND order_id = v_order.id AND status <> 'voided'
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Linha do pedido não encontrada.' USING ERRCODE = 'P0002';
        END IF;
        v_qty := round(COALESCE((v_pick ->> 'quantity')::numeric, 0), 3);
        IF v_qty <= 0 THEN CONTINUE; END IF;
        IF v_qty > v_line.quantity - v_line.paid_quantity THEN
          RAISE EXCEPTION 'Só faltam pagar % de %.', v_line.quantity - v_line.paid_quantity, v_line.product_name
            USING ERRCODE = '22023';
        END IF;
        v_lines := v_lines || jsonb_build_object('product_id', v_line.product_id, 'quantity', v_qty,
                                                 'unit_price', v_line.unit_price, 'notes', v_line.notes,
                                                 'order_line_id', v_line.id);
      END LOOP;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'quantity', l.quantity - l.paid_quantity,
                                                   'unit_price', l.unit_price, 'notes', l.notes,
                                                   'order_line_id', l.id) ORDER BY l.created_at), '[]'::jsonb)
        INTO v_lines
        FROM pos_order_lines l
       WHERE l.order_id = v_order.id AND l.status <> 'voided' AND l.quantity > l.paid_quantity;
    END IF;

    IF jsonb_array_length(v_lines) = 0 THEN
      RAISE EXCEPTION 'Não há nada por pagar neste pedido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_payload := p_payload
    || jsonb_build_object('table_label', COALESCE((SELECT 'Mesa ' || name FROM pos_tables WHERE id = v_order.table_id), p_payload ->> 'table_label'),
                          'covers', v_order.covers);

  v_invoice := public._pos_issue_fr(c, v_payload, p_auth_pin, v_lines);

  IF NOT v_existing THEN
    FOR v_pick IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
      UPDATE pos_order_lines SET paid_quantity = paid_quantity + (v_pick ->> 'quantity')::numeric
       WHERE id = (v_pick ->> 'order_line_id')::uuid;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM pos_order_lines WHERE order_id = v_order.id AND status <> 'voided' AND quantity > paid_quantity
    ) THEN
      UPDATE pos_orders SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = v_order.id;
      -- Linhas por enviar que foram pagas contam como servidas.
      UPDATE pos_order_lines SET status = 'sent', sent_at = COALESCE(sent_at, now())
       WHERE order_id = v_order.id AND status = 'pending';
      v_closed := true;
    ELSE
      UPDATE pos_orders SET updated_at = now() WHERE id = v_order.id;
    END IF;
  END IF;

  v_doc := public._pos_document(v_invoice);
  PERFORM public._pos_audit(c.company_id, 'POS: Emitiu Factura-Recibo', v_invoice, v_doc ->> 'number',
    jsonb_build_object('total', v_doc -> 'total', 'staff', c.staff_name, 'terminal', c.terminal_name,
                       'table', v_doc ->> 'table_label'));

  RETURN jsonb_build_object('document', v_doc, 'order', public._pos_order_json(p_order_id), 'order_closed', v_closed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_checkout_order(text, uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Permissões da Data API (o Supabase deixou de as dar automaticamente)
-- ---------------------------------------------------------------------------
-- Leitura para a aplicação e para o Realtime dos terminais; escrita só pelas funções.
GRANT SELECT ON public.pos_orders, public.pos_order_lines TO authenticated;
GRANT ALL ON public.pos_orders, public.pos_order_lines TO service_role;
