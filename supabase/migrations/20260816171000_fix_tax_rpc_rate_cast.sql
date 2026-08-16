-- Corrige a chamada da função fiscal legada, cuja terceira assinatura é integer.
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
