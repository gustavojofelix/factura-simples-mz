-- Depois de a subscrição expirar, o cliente pode escolher qualquer plano pago.
--
-- Revê 20261028100000_block_downgrade_always: o plano de nível inferior volta a
-- ser bloqueado só enquanto a subscrição estiver activa (dentro do período).
--   * Pago -> gratuito (Trial): continua sempre bloqueado.
--   * Plano de nível inferior: bloqueado só com a subscrição activa.
--   * Ciclo mais curto: bloqueado só com a subscrição activa (sem alteração,
--     regra na versão com ciclo).
-- A versão com ciclo, is_subscription_downgrade e o trigger chamam esta função,
-- por isso basta substituí-la.

CREATE OR REPLACE FUNCTION public.subscription_change_is_downgrade(
  p_current_plan_id   uuid,
  p_current_plan_name text,
  p_current_status    text,
  p_current_end_date  date,
  p_target_plan_id    uuid,
  p_target_plan_name  text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur_tier   integer;
  v_new_tier   integer;
  v_cur_price  numeric;
  v_new_price  numeric;
  v_active     boolean;
BEGIN
  v_cur_price := public.subscription_plan_monthly_price(p_current_plan_id, p_current_plan_name);
  v_new_price := public.subscription_plan_monthly_price(p_target_plan_id, p_target_plan_name);

  -- Plano pago -> plano gratuito: sempre bloqueado.
  IF COALESCE(v_cur_price, 0) > 0 AND v_new_price IS NOT NULL AND v_new_price = 0 THEN
    RETURN true;
  END IF;

  -- Subscrição expirada/cancelada: qualquer plano pago é permitido.
  v_active := p_current_status IN ('active', 'trialing')
              AND (p_current_end_date IS NULL OR p_current_end_date >= public.subscription_today());
  IF NOT v_active THEN
    RETURN false;
  END IF;

  v_cur_tier := public.subscription_plan_tier(p_current_plan_id, p_current_plan_name);
  v_new_tier := public.subscription_plan_tier(p_target_plan_id, p_target_plan_name);
  IF v_cur_tier IS NULL OR v_new_tier IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_new_tier < v_cur_tier;
END;
$$;
