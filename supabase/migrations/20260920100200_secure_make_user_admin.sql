-- `make_user_admin` estava concedida a `anon`: qualquer pedido HTTP não
-- autenticado a /rest/v1/rpc/make_user_admin promovia qualquer conta a
-- administrador da plataforma. Sendo SECURITY DEFINER, contornava todo o RLS.
--
-- A função continua a ser necessária — o back office usa-a em
-- admin-access.component.ts ao conceder acesso a um novo administrador — pelo
-- que passa a validar quem a invoca em vez de ser removida.

REVOKE EXECUTE ON FUNCTION public.make_user_admin(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.make_user_admin(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.make_user_admin(target_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_actor uuid := (SELECT auth.uid());
BEGIN
  -- Só um administrador existente, ou um processo de servidor (service role,
  -- onde auth.uid() é NULL), pode promover alguém.
  IF v_actor IS NOT NULL AND NOT COALESCE(
       (SELECT role = 'admin' FROM public.profiles WHERE id = v_actor),
       false
     ) THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem conceder acesso ao back office.'
      USING ERRCODE = 'P0001', DETAIL = 'FORBIDDEN_ADMIN_PROMOTION';
  END IF;

  SELECT id INTO v_user_id
    FROM auth.users
   WHERE lower(email) = lower(trim(target_email))
   LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, role, full_name)
    VALUES (
      v_user_id,
      lower(trim(target_email)),
      'admin',
      COALESCE(
        (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = v_user_id),
        split_part(target_email, '@', 1)
      )
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        email = EXCLUDED.email,
        updated_at = now();
  ELSE
    UPDATE public.profiles
       SET role = 'admin'
     WHERE lower(email) = lower(trim(target_email));
  END IF;

  RETURN true;
END;
$$;

-- A chamada continua disponível a utilizadores autenticados; a própria função
-- recusa quem não for administrador.
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO service_role;
