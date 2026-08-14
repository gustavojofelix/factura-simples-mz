-- Migration: Fix uses_count not incrementing when voucher is redeemed
-- Root cause: The RLS policy on `vouchers` only allows SELECT for authenticated
-- users. The UPDATE on uses_count is blocked. The SECURITY DEFINER RPC bypasses
-- RLS, but users also need INSERT on voucher_redemptions for their own user_id.

-- 1. Allow authenticated users to SELECT all vouchers (not just active ones
--    when validating) -- keep existing, but also allow reading inactive for
--    the RPC to work correctly when fetching current uses_count.
--    The RPC is SECURITY DEFINER so it already bypasses RLS, but let's also
--    make the fallback path work.

-- 2. Ensure the redeem_voucher RPC can always update uses_count.
--    Re-create the function to be explicit and robust.
CREATE OR REPLACE FUNCTION public.redeem_voucher(
  p_voucher_id       UUID,
  p_company_id       UUID,
  p_user_id          UUID,
  p_discount_applied NUMERIC(10, 2)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the function owner (postgres), bypasses RLS
SET search_path = public
AS $$
DECLARE
  v_rows INT;
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

  -- Atomically increment uses_count (avoids race conditions)
  UPDATE public.vouchers
  SET
    uses_count = COALESCE(uses_count, 0) + 1,
    updated_at = now()
  WHERE id = p_voucher_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Return TRUE only if the voucher row was actually updated
  RETURN v_rows > 0;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.redeem_voucher(UUID, UUID, UUID, NUMERIC) TO authenticated;
-- Also grant to anon in case a session is not yet established
GRANT EXECUTE ON FUNCTION public.redeem_voucher(UUID, UUID, UUID, NUMERIC) TO anon;

-- 3. Allow authenticated users to INSERT their own redemptions (fallback path)
DROP POLICY IF EXISTS "Users can insert redemptions" ON public.voucher_redemptions;
CREATE POLICY "Users can insert redemptions"
ON public.voucher_redemptions
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow if user_id matches the current user, OR user_id is null (company-only redemption)
  user_id IS NULL OR auth.uid() = user_id
);

-- 4. Allow users to read their own redemptions
DROP POLICY IF EXISTS "Users can view own redemptions" ON public.voucher_redemptions;
CREATE POLICY "Users can view own redemptions"
ON public.voucher_redemptions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id IN (
    SELECT company_id FROM public.company_users WHERE user_id = auth.uid()
  )
);
