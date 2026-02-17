-- Migration: Fix relationships between companies/profiles for better joins

-- 1. Update companies.user_id to reference profiles(id)
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_user_id_fkey;
ALTER TABLE public.companies 
  ADD CONSTRAINT companies_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES public.profiles(id) 
  ON DELETE CASCADE;

-- 2. Update company_users.user_id to reference profiles(id)
ALTER TABLE public.company_users DROP CONSTRAINT IF EXISTS company_users_user_id_fkey;
ALTER TABLE public.company_users 
  ADD CONSTRAINT company_users_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES public.profiles(id) 
  ON DELETE CASCADE;

-- 3. Comments
COMMENT ON CONSTRAINT companies_user_id_fkey ON public.companies IS 'Relaciona a empresa ao perfil do proprietário';
COMMENT ON CONSTRAINT company_users_user_id_fkey ON public.company_users IS 'Relaciona o acesso à empresa ao perfil do utilizador';
