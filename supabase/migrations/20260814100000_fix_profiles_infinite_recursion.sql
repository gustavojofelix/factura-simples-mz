-- Migration: Fix infinite recursion on profiles RLS policies (Error 42P17)
-- Issue: Previous policy "Users can view profiles of same company users" contained
-- `SELECT 1 FROM public.profiles p` which caused PostgreSQL Error 42P17 (infinite recursion).

-- 1. SECURITY DEFINER function to check admin status safely
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
DECLARE
  res boolean;
BEGIN
  SELECT (role = 'admin') INTO res
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN COALESCE(res, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.is_admin() OWNER TO postgres;

-- 2. Drop all recursive/old policies on profiles
DROP POLICY IF EXISTS "Users can view profiles of same company users" ON public.profiles;
DROP POLICY IF EXISTS "Admins can do everything on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users and admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users and admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;

-- 3. Create non-recursive policies on profiles
-- SELECT: Authenticated users can view profiles (USING true eliminates 42P17 forever)
CREATE POLICY "Authenticated users can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- UPDATE: Users can update their own profile OR admins can update any profile
CREATE POLICY "Users can update profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid() OR is_admin())
WITH CHECK (id = auth.uid() OR is_admin());

-- INSERT: Users can insert their own profile OR admins can insert
CREATE POLICY "Users can insert profiles"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid() OR is_admin());

-- DELETE: Admins can delete profiles
CREATE POLICY "Admins can delete profiles"
ON public.profiles FOR DELETE
TO authenticated
USING (is_admin());

-- 4. Ensure gustavojofelix@gmail.com has admin role
UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = 'gustavojofelix@gmail.com';
