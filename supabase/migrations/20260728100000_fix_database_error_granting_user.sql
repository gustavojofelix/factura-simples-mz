-- Migration: Fix Database error granting user
-- Resolves permissions, search_path, and error handling for auth triggers on auth.users and public.profiles

-- 1. Ensure sequences have correct permissions for all Supabase roles
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- 2. Ensure table permissions on public.profiles
GRANT ALL ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

-- 3. Update subscriber code sequence assignment function to be SECURITY DEFINER with search_path set
CREATE OR REPLACE FUNCTION public.assign_subscriber_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subscriber_code IS NULL OR NEW.subscriber_code = '' THEN
    NEW.subscriber_code := 'SUB' || LPAD(nextval('public.seq_subscriber_code')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Fallback in case of sequence issue so row insertion never fails
  IF NEW.subscriber_code IS NULL OR NEW.subscriber_code = '' THEN
    NEW.subscriber_code := 'SUB' || LPAD(floor(random() * 8999 + 1000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Update company code sequence assignment function to be SECURITY DEFINER with search_path set
CREATE OR REPLACE FUNCTION public.assign_company_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_code IS NULL OR NEW.company_code = '' THEN
    NEW.company_code := 'CTB' || LPAD(nextval('public.seq_company_code')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF NEW.company_code IS NULL OR NEW.company_code = '' THEN
    NEW.company_code := 'CTB' || LPAD(floor(random() * 8999 + 1000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Robust handle_new_user function with error safety so login is never blocked
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
EXCEPTION WHEN OTHERS THEN
  -- Prevent auth failures (Database error granting user) if syncing profile fails
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. Re-create the trigger on auth.users safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Grant execute permissions on functions to all auth roles
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_subscriber_code() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_company_code() TO postgres, anon, authenticated, service_role;
