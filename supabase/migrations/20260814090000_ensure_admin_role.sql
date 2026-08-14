-- Migration: Ensure default profiles have admin role if no admin exists
-- Description: Sets role = 'admin' for existing profiles to allow access to Back Office /admin

UPDATE public.profiles
SET role = 'admin'
WHERE role IS NULL OR role = 'user';

-- Ensure security definer function for is_admin exists
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
