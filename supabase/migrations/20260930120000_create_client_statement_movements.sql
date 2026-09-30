/*
  # Extracto específico de um cliente

  `client_statement_movements(company_id, client_id, start, end)` devolve:
    - client: dados do cliente
    - opening_balance: saldo antes da data inicial
    - movements: facturas e recibos do período, por ordem cronológica

  Segue as mesmas regras do extracto geral (client_statement_summary):
  ficam de fora rascunhos, facturas anuladas, os recibos dessas facturas e os
  recibos anulados.
  O saldo corrido é calculado na aplicação, para poder ser ocultado quando o
  utilizador filtra só facturas ou só recibos.
*/

CREATE OR REPLACE FUNCTION public.client_statement_movements(
  p_company_id uuid,
  p_client_id uuid,
  p_start date,
  p_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client jsonb;
  v_opening numeric;
  v_movements jsonb;
BEGIN
  IF NOT public.can_view_client_statements(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para consultar extractos desta empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
           'id', c.id,
           'client_code', c.client_code,
           'name', c.name,
           'nuit', c.nuit,
           'address', c.address,
           'phone', c.phone,
           'email', c.email
         )
    INTO v_client
    FROM public.clients c
   WHERE c.id = p_client_id
     AND c.company_id = p_company_id;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta empresa' USING ERRCODE = 'P0002';
  END IF;

  -- Saldo anterior
  SELECT COALESCE((
           SELECT sum(i.total)
             FROM public.invoices i
            WHERE i.company_id = p_company_id
              AND i.client_id = p_client_id
              AND i.status NOT IN ('rascunho', 'anulada')
              AND i.date < p_start
         ), 0)
       - COALESCE((
           SELECT sum(p.amount)
             FROM public.payments p
             JOIN public.invoices i ON i.id = p.invoice_id
            WHERE p.company_id = p_company_id
              AND p.status = 'emitido'
              AND i.client_id = p_client_id
              AND i.status NOT IN ('rascunho', 'anulada')
              AND p.payment_date < p_start
         ), 0)
    INTO v_opening;

  -- Movimentos do período. No mesmo dia, a factura aparece antes do recibo.
  SELECT COALESCE(jsonb_agg(m.row ORDER BY m.sort_date, m.sort_kind, m.created_at), '[]'::jsonb)
    INTO v_movements
    FROM (
      SELECT i.date AS sort_date,
             0 AS sort_kind,
             i.created_at,
             jsonb_build_object(
               'kind', 'factura',
               'date', i.date,
               'document', i.invoice_number,
               'invoice_id', i.id,
               'invoice_number', i.invoice_number,
               'payment_id', NULL,
               'due_date', i.due_date,
               'first_item', (
                 SELECT ii.product_name
                   FROM public.invoice_items ii
                  WHERE ii.invoice_id = i.id
                  ORDER BY ii.created_at NULLS LAST, ii.id
                  LIMIT 1
               ),
               'item_count', (
                 SELECT count(*) FROM public.invoice_items ii WHERE ii.invoice_id = i.id
               ),
               'invoiced', ROUND(i.total, 2),
               'paid', 0
             ) AS row
        FROM public.invoices i
       WHERE i.company_id = p_company_id
         AND i.client_id = p_client_id
         AND i.status NOT IN ('rascunho', 'anulada')
         AND i.date BETWEEN p_start AND p_end

      UNION ALL

      SELECT p.payment_date,
             1,
             p.created_at,
             jsonb_build_object(
               'kind', 'recibo',
               'date', p.payment_date,
               'document', p.receipt_number,
               'invoice_id', i.id,
               'invoice_number', i.invoice_number,
               'payment_id', p.id,
               'payment_method', p.payment_method,
               'reference', p.reference,
               'invoiced', 0,
               'paid', ROUND(p.amount, 2)
             )
        FROM public.payments p
        JOIN public.invoices i ON i.id = p.invoice_id
       WHERE p.company_id = p_company_id
         AND p.status = 'emitido'
         AND i.client_id = p_client_id
         AND i.status NOT IN ('rascunho', 'anulada')
         AND p.payment_date BETWEEN p_start AND p_end
    ) m;

  RETURN jsonb_build_object(
    'client', v_client,
    'opening_balance', ROUND(v_opening, 2),
    'movements', v_movements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_statement_movements(uuid, uuid, date, date) TO authenticated;
