/*
  # Extractos de clientes

  1. `can_view_client_statements(company_id)`
    - Proprietário da empresa, ou utilizador partilhado activo com o papel
      admin/manager. O Vendedor (user) não tem acesso.

  2. `client_statement_summary(company_id, start, end, client_ids)`
    - Extracto geral: uma linha por cliente da empresa.

  Regras de cálculo (comuns a todos os extractos):
    - Contam as facturas emitidas: ficam de fora rascunhos e anuladas.
    - Contam os recibos emitidos (não anulados) de facturas emitidas. Os recibos de uma factura anulada
      também ficam de fora, para que a anulação não deixe crédito fantasma.
    - Saldo anterior = facturado antes do início - pago antes do início.
    - Total facturado = facturas com data dentro do período.
    - Total pago = recibos com data de pagamento dentro do período, mesmo que
      liquidem facturas mais antigas.
    - Saldo = saldo anterior + total facturado - total pago (acumulado até à
      data final).
    - Estado:
        pago      saldo <= 0
        vencido   saldo > 0 e pelo menos uma factura com vencimento anterior à
                  data de referência (a menor entre a data final e hoje) ainda
                  por pagar nessa data
        em_divida restantes casos com saldo > 0
*/

CREATE OR REPLACE FUNCTION public.can_view_client_statements(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_company_role(p_company_id, ARRAY['owner', 'admin', 'manager']);
$$;

GRANT EXECUTE ON FUNCTION public.can_view_client_statements(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.client_statement_summary(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  client_id uuid,
  client_code text,
  client_name text,
  client_nuit text,
  opening_balance numeric,
  total_invoiced numeric,
  total_paid numeric,
  balance numeric,
  overdue_amount numeric,
  invoice_count integer,
  receipt_count integer,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ref_date date;
BEGIN
  IF NOT public.can_view_client_statements(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para consultar extractos desta empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  v_ref_date := LEAST(p_end, CURRENT_DATE);

  RETURN QUERY
  WITH valid_invoices AS (
    SELECT i.id, i.client_id, i.date, i.due_date, i.total
      FROM public.invoices i
     WHERE i.company_id = p_company_id
       AND i.status NOT IN ('rascunho', 'anulada')
       AND i.date <= p_end
  ),
  valid_payments AS (
    SELECT p.invoice_id, vi.client_id, p.payment_date, p.amount
      FROM public.payments p
      JOIN valid_invoices vi ON vi.id = p.invoice_id
     WHERE p.company_id = p_company_id
       AND p.status = 'emitido'
       AND p.payment_date <= p_end
  ),
  inv AS (
    SELECT vi.client_id,
           COALESCE(sum(vi.total) FILTER (WHERE vi.date < p_start), 0) AS before_start,
           COALESCE(sum(vi.total) FILTER (WHERE vi.date >= p_start), 0) AS in_period,
           count(*) FILTER (WHERE vi.date >= p_start) AS n
      FROM valid_invoices vi
     GROUP BY vi.client_id
  ),
  pay AS (
    SELECT vp.client_id,
           COALESCE(sum(vp.amount) FILTER (WHERE vp.payment_date < p_start), 0) AS before_start,
           COALESCE(sum(vp.amount) FILTER (WHERE vp.payment_date >= p_start), 0) AS in_period,
           count(*) FILTER (WHERE vp.payment_date >= p_start) AS n
      FROM valid_payments vp
     GROUP BY vp.client_id
  ),
  overdue AS (
    -- Valor em atraso na data de referência, factura a factura.
    SELECT vi.client_id,
           sum(vi.total - COALESCE(paid.amount, 0)) AS amount
      FROM valid_invoices vi
      LEFT JOIN LATERAL (
        SELECT sum(vp.amount) AS amount
          FROM valid_payments vp
         WHERE vp.invoice_id = vi.id
           AND vp.payment_date <= v_ref_date
      ) paid ON true
     WHERE vi.due_date IS NOT NULL
       AND vi.due_date < v_ref_date
       AND vi.total - COALESCE(paid.amount, 0) > 0.005
     GROUP BY vi.client_id
  ),
  summary AS (
    SELECT c.id,
           c.client_code,
           c.name,
           c.nuit,
           ROUND(COALESCE(inv.before_start, 0) - COALESCE(pay.before_start, 0), 2) AS opening,
           ROUND(COALESCE(inv.in_period, 0), 2) AS invoiced,
           ROUND(COALESCE(pay.in_period, 0), 2) AS paid,
           ROUND(COALESCE(overdue.amount, 0), 2) AS overdue_amount,
           COALESCE(inv.n, 0)::integer AS invoice_count,
           COALESCE(pay.n, 0)::integer AS receipt_count
      FROM public.clients c
      LEFT JOIN inv ON inv.client_id = c.id
      LEFT JOIN pay ON pay.client_id = c.id
      LEFT JOIN overdue ON overdue.client_id = c.id
     WHERE c.company_id = p_company_id
       AND (p_client_ids IS NULL OR c.id = ANY (p_client_ids))
  )
  -- Conversões explícitas: RETURN QUERY exige os tipos exactos da assinatura.
  SELECT r.id,
         r.client_code::text,
         r.name::text,
         r.nuit::text,
         r.opening::numeric,
         r.invoiced::numeric,
         r.paid::numeric,
         (r.opening + r.invoiced - r.paid)::numeric,
         r.overdue_amount::numeric,
         r.invoice_count,
         r.receipt_count,
         CASE
           WHEN r.opening + r.invoiced - r.paid <= 0.005 THEN 'pago'
           WHEN r.overdue_amount > 0 THEN 'vencido'
           ELSE 'em_divida'
         END::text
    FROM summary r
   ORDER BY r.client_code NULLS LAST, r.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_statement_summary(uuid, date, date, uuid[]) TO authenticated;
