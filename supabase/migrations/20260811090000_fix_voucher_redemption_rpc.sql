-- Migration: Fix voucher redemption RPC and policies
CREATE OR REPLACE FUNCTION public.redeem_voucher(
  p_voucher_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_discount_applied NUMERIC(10, 2)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert redemption record
  INSERT INTO public.voucher_redemptions (
    voucher_id,
    company_id,
    user_id,
    discount_applied,
    redeemed_at
  )
  VALUES (
    p_voucher_id,
    p_company_id,
    p_user_id,
    p_discount_applied,
    now()
  );

  -- Increment uses_count on the voucher
  UPDATE public.vouchers
  SET uses_count = COALESCE(uses_count, 0) + 1,
      updated_at = now()
  WHERE id = p_voucher_id;

  RETURN TRUE;
END;
$$;

-- Allow authenticated users to call redeem_voucher function
GRANT EXECUTE ON FUNCTION public.redeem_voucher(UUID, UUID, UUID, NUMERIC) TO authenticated;
