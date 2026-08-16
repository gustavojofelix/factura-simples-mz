-- Migration: Update make_user_admin function to handle missing profiles atomically
-- Description: Bypasses RLS and handle race condition where a profile is not yet inserted by the handle_new_user trigger.

CREATE OR REPLACE FUNCTION public.make_user_admin(target_email text)
RETURNS boolean AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- 1. Try to find the user in auth.users by email
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE lower(email) = lower(trim(target_email)) 
  LIMIT 1;
  
  IF v_user_id IS NOT NULL THEN
    -- 2. Insert or update profile with role = 'admin'
    INSERT INTO public.profiles (id, email, role, full_name)
    VALUES (
      v_user_id,
      lower(trim(target_email)),
      'admin',
      COALESCE((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = v_user_id), split_part(target_email, '@', 1))
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        email = EXCLUDED.email,
        updated_at = now();
  ELSE
    -- 3. Fallback: Update if profile exists but auth user is not yet created
    UPDATE public.profiles
    SET role = 'admin'
    WHERE lower(email) = lower(trim(target_email));
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-grant execute permissions
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO anon;
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO service_role;
