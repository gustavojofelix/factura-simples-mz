/*
  # Backoffice: visão das empresas com Ponto de Venda

  `admin_pos_overview()` devolve, para cada empresa, o estado do POS e a
  utilização, numa só chamada (a lista de Contribuintes do /admin):
    enabled      POS disponível (plano da última subscrição ou excepção)
    source       'override' (activado no backoffice) | 'plan' | null
    allowed      pode vender agora (subscrição activa ou em tolerância)
    in_grace     subscrição expirada, ainda dentro da tolerância
    business_type, terminals (activos), staff (activos), last_sale_at, sales_30d

  Só para administradores da plataforma.
*/

CREATE OR REPLACE FUNCTION public.admin_pos_overview()
RETURNS TABLE (
  company_id uuid,
  enabled boolean,
  source text,
  allowed boolean,
  in_grace boolean,
  business_type text,
  terminals integer,
  staff integer,
  last_sale_at timestamptz,
  sales_30d numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id,
         COALESCE((a.access ->> 'enabled')::boolean, false),
         CASE
           WHEN o.enabled IS TRUE THEN 'override'
           WHEN COALESCE((a.access ->> 'enabled')::boolean, false) THEN 'plan'
           ELSE NULL
         END,
         COALESCE((a.access ->> 'allowed')::boolean, false),
         COALESCE((a.access ->> 'in_grace')::boolean, false),
         c.pos_business_type,
         (SELECT count(*)::integer FROM pos_terminals t WHERE t.company_id = c.id AND t.revoked_at IS NULL),
         (SELECT count(*)::integer FROM pos_staff s WHERE s.company_id = c.id AND s.is_active),
         (SELECT max(i.created_at) FROM invoices i WHERE i.company_id = c.id AND i.origin = 'pos'),
         COALESCE((SELECT sum(i.total) FROM invoices i
                    WHERE i.company_id = c.id AND i.origin = 'pos' AND i.status <> 'anulada'
                      AND i.date >= CURRENT_DATE - 30), 0)
    FROM companies c
    CROSS JOIN LATERAL (SELECT public.company_pos_access(c.id) AS access) a
    LEFT JOIN company_feature_overrides o ON o.company_id = c.id AND o.feature_code = 'pos';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pos_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pos_overview() TO authenticated;

/*
  Configuração "Geral" do POS (tipo de negócio e pos_settings).
  A política de UPDATE de companies só deixa o dono gravar; o Admin e o
  Gestor da empresa também configuram o POS, por isso a gravação passa por
  aqui e só mexe nestes dois campos.
*/
CREATE OR REPLACE FUNCTION public.pos_save_settings(
  p_company_id uuid,
  p_business_type text,
  p_settings jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pos_is_manager(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o Ponto de Venda desta empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_business_type NOT IN ('retail', 'restaurant') THEN
    RAISE EXCEPTION 'Tipo de negócio inválido.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_settings, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuração inválida.' USING ERRCODE = '22023';
  END IF;

  UPDATE companies
     SET pos_business_type = p_business_type,
         pos_settings = COALESCE(p_settings, '{}'::jsonb)
   WHERE id = p_company_id;

  INSERT INTO audit_logs (company_id, action, category, entity_id, entity_name, details)
  VALUES (p_company_id, 'POS: Alterou a configuração', 'pos', p_company_id, p_business_type, p_settings);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_save_settings(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_save_settings(uuid, text, jsonb) TO authenticated;
