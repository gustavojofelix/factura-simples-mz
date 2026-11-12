/*
  # Correcção: company_pos_access com subscrições expiradas

  Em produção subscriptions.end_date é timestamptz; "end_date + v_grace"
  (timestamptz + integer) falhava sempre que a última subscrição já tinha
  expirado. Isso partia admin_pos_overview() (coluna POS dos Contribuintes)
  e o acesso ao POS das empresas em período de tolerância.

  A data de fim passa a ser normalizada para a data de Maputo. Funciona tanto
  com date como com timestamptz.
*/

CREATE OR REPLACE FUNCTION public.company_pos_access(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date;
  v_grace integer;
  v_enabled boolean;
  v_active boolean;
  v_in_grace boolean := false;
  v_grace_until date;
  v_end date;
BEGIN
  SELECT s.plan_id, s.status, s.end_date
    INTO v_sub
    FROM subscriptions s
   WHERE s.company_id = p_company_id
   ORDER BY (s.status IN ('active', 'trialing')) DESC, s.end_date DESC NULLS FIRST, s.updated_at DESC
   LIMIT 1;

  SELECT COALESCE(o.enabled, pf.enabled, false)
    INTO v_enabled
    FROM subscription_features f
    LEFT JOIN subscription_plan_features pf ON pf.feature_id = f.id AND pf.plan_id = v_sub.plan_id
    LEFT JOIN company_feature_overrides o ON o.company_id = p_company_id AND o.feature_code = f.code
   WHERE f.code = 'pos' AND f.is_active;
  v_enabled := COALESCE(v_enabled, false);

  v_grace := COALESCE(
    (SELECT (value #>> '{}')::integer FROM platform_settings WHERE key = 'pos_grace_days'),
    5
  );

  -- end_date é timestamptz em produção (date nas migrações antigas): normalizar
  -- para a data de Maputo antes de somar dias.
  v_end := (v_sub.end_date AT TIME ZONE 'Africa/Maputo')::date;

  v_active := v_sub.status IN ('active', 'trialing')
              AND (v_end IS NULL OR v_end >= v_today);

  IF NOT COALESCE(v_active, false) AND v_end IS NOT NULL
     AND v_sub.status IN ('active', 'trialing', 'past_due') THEN
    v_grace_until := v_end + v_grace;
    v_in_grace := v_today <= v_grace_until;
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'active', COALESCE(v_active, false),
    'in_grace', v_in_grace,
    'grace_until', v_grace_until,
    'end_date', v_end,
    'allowed', v_enabled AND (COALESCE(v_active, false) OR v_in_grace)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_pos_access(uuid) TO authenticated;
