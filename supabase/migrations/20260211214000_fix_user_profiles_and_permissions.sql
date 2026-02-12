-- Migration: Fix user profiles and permissions
-- 1. Add email to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- 2. Create function to handle user creation/sync
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

-- 3. Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Secure function to search for a user by email from the frontend
-- This allows finding a user's ID without exposing auth.users directly
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_query text)
RETURNS uuid AS $$
  SELECT id FROM auth.users WHERE email = email_query LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- 5. Backfill existing profiles (User might need to run this manually if trigger doesn't fire for old records)
-- UPDATE public.profiles p SET email = u.email FROM auth.users u WHERE p.id = u.id AND p.email IS NULL;
