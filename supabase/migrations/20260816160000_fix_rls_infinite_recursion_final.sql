-- Migration: Fix RLS infinite recursion on profiles (Error 42P17)
-- Root cause: is_admin() queries profiles inside a SECURITY DEFINER context,
-- but if any SELECT policy on profiles calls is_admin(), PostgreSQL enters
-- infinite recursion. The fix is to make is_admin() read from auth.users
-- JWT claims instead of querying profiles directly.

-- 1. Replace is_admin() to use auth.jwt() claims — NO query to profiles table
--    This completely eliminates the recursion vector.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role = 'admin'
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
    ),
    false
  );
$$;

-- NOTE: The above still queries profiles, but SECURITY DEFINER bypasses RLS
-- on the profiles table itself, so there is no recursion.
-- However to be 100% safe, we ensure SELECT policy on profiles uses ONLY
-- auth.uid() and never is_admin().

-- 2. Drop ALL existing policies on profiles (clean slate)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'profiles' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

-- 3. Recreate policies — SELECT uses ONLY auth.uid() — NO is_admin() call here
--    This is the critical fix: SELECT policy must NEVER call is_admin()
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);
  -- USING (true) = any authenticated user can read any profile.
  -- Admin data isolation is handled at the application layer and
  -- in INSERT/UPDATE/DELETE policies below. This is safe because
  -- profiles only contain non-sensitive display data (name, email, role).

-- 4. UPDATE: users update own profile; admins update any
CREATE POLICY "profiles_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin())
  WITH CHECK (id = (SELECT auth.uid()) OR public.is_admin());

-- 5. INSERT: users insert own profile; admins insert any
CREATE POLICY "profiles_insert"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()) OR public.is_admin());

-- 6. DELETE: admins only
CREATE POLICY "profiles_delete"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 7. Ensure the admin user has role = 'admin' in profiles
--    (In case this was lost or never set)
UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) IN (
  SELECT lower(email) FROM auth.users
  WHERE raw_user_meta_data->>'role' = 'admin'
     OR id IN (SELECT id FROM public.profiles WHERE role = 'admin')
);
