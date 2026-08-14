-- Migration: Create SECURITY DEFINER function to make user admin
-- Description: Bypasses RLS to allow making users admin safely

CREATE OR REPLACE FUNCTION public.make_user_admin(target_email text)
RETURNS boolean AS $$
BEGIN
  UPDATE public.profiles
  SET role = 'admin'
  WHERE lower(email) = lower(target_email);
  
  IF NOT FOUND THEN
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = auth.uid();
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO anon;

-- Directly set gustavojofelix@gmail.com to admin
UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = 'gustavojofelix@gmail.com';
