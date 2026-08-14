-- Migration: Fix profiles RLS policy and email backfill
-- Issue: Users in company_users displayed "N/A" for email because RLS policy
-- on `profiles` restricted SELECT strictly to own profile (id = auth.uid()).

-- 1. Ensure email column exists on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 2. Backfill missing emails from auth.users into profiles
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- 3. Update handle_new_user trigger to always sync email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS Policy: Allow authenticated users to view profiles of users
-- in companies they belong to (or their own profile)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles of same company users" ON public.profiles;

CREATE POLICY "Users can view profiles of same company users"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = (select auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.company_users cu1
    JOIN public.company_users cu2 ON cu1.company_id = cu2.company_id
    WHERE cu1.user_id = (select auth.uid())
      AND cu2.user_id = public.profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.role = 'admin'
  )
);
