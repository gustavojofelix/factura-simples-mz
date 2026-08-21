-- Server-side enforcement. UI checks are only explanatory; these functions and
-- triggers are the authoritative guard against API/direct database writes.

CREATE OR REPLACE FUNCTION public.subscription_plan_for_company(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.plan_id FROM public.subscriptions s
      WHERE s.company_id = p_company_id
        AND s.status IN ('active', 'trialing')
        AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
      ORDER BY s.updated_at DESC LIMIT 1),
    (SELECT p.id FROM public.subscription_plans p WHERE p.code = 'trial' LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.subscription_plan_for_account(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.subscription_plan_for_company(c.id)
       FROM public.companies c
      WHERE c.user_id = p_user_id
      ORDER BY c.created_at ASC LIMIT 1),
    (SELECT p.id FROM public.subscription_plans p WHERE p.code = 'trial' LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.subscription_feature_value(
  p_company_id uuid,
  p_feature_code text
)
RETURNS TABLE(enabled boolean, limit_value bigint, value_type text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pf.enabled, pf.limit_value, f.value_type, f.scope
    FROM public.subscription_plan_features pf
    JOIN public.subscription_features f ON f.id = pf.feature_id
   WHERE pf.plan_id = public.subscription_plan_for_company(p_company_id)
     AND f.code = p_feature_code
     AND f.is_active = true
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.assert_subscription_limit(
  p_company_id uuid,
  p_feature_code text,
  p_current_count bigint,
  p_requested_count bigint DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_limit bigint;
  v_type text;
BEGIN
  SELECT enabled, limit_value, value_type
    INTO v_enabled, v_limit, v_type
    FROM public.subscription_feature_value(p_company_id, p_feature_code);

  IF v_type IS NULL OR v_type <> 'limit' OR COALESCE(v_enabled, false) = false THEN
    RAISE EXCEPTION 'A funcionalidade % não está disponível no seu plano.', p_feature_code
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_FEATURE_DISABLED';
  END IF;

  IF v_limit IS NOT NULL AND p_current_count + p_requested_count > v_limit THEN
    RAISE EXCEPTION 'O limite do seu plano para % foi atingido (%).', p_feature_code, v_limit
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_LIMIT_REACHED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_subscription_feature(
  p_company_id uuid,
  p_feature_code text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled
    FROM public.subscription_feature_value(p_company_id, p_feature_code);
  IF COALESCE(v_enabled, false) = false THEN
    RAISE EXCEPTION 'A funcionalidade % não está disponível no seu plano.', p_feature_code
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_FEATURE_DISABLED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_company_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan uuid;
  v_enabled boolean;
  v_limit bigint;
  v_count bigint;
BEGIN
  -- Backoffice administrators may provision data administratively.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  v_plan := public.subscription_plan_for_account(NEW.user_id);
  SELECT pf.enabled, pf.limit_value INTO v_enabled, v_limit
    FROM public.subscription_plan_features pf
    JOIN public.subscription_features f ON f.id = pf.feature_id
   WHERE pf.plan_id = v_plan AND f.code = 'max_companies';

  v_count := (SELECT count(*) FROM public.companies WHERE user_id = NEW.user_id);
  IF COALESCE(v_enabled, false) = false THEN
    RAISE EXCEPTION 'O seu plano não permite criar empresas adicionais.' USING ERRCODE = 'P0001';
  END IF;
  IF v_limit IS NOT NULL AND v_count + 1 > v_limit THEN
    RAISE EXCEPTION 'O limite de empresas do seu plano foi atingido (%).', v_limit USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_company_subscription_limit ON public.companies;
CREATE TRIGGER enforce_company_subscription_limit
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_limit();

CREATE OR REPLACE FUNCTION public.enforce_invoice_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Drafts and annulled invoices never consume quota. On update, only the
  -- transition into a billable status is counted.
  IF NEW.status IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('rascunho', 'anulada') THEN RETURN NEW; END IF;

  PERFORM public.assert_subscription_feature(NEW.company_id, 'invoicing');

  v_count := (
    SELECT count(*) FROM public.invoices i
     WHERE i.company_id = NEW.company_id
       AND i.status NOT IN ('rascunho', 'anulada')
       AND i.date >= date_trunc('month', CURRENT_DATE)::date
       AND i.date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
  );
  PERFORM public.assert_subscription_limit(NEW.company_id, 'max_invoices_month', v_count, 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_invoice_subscription_limit ON public.invoices;
CREATE TRIGGER enforce_invoice_subscription_limit
  BEFORE INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_limit();

CREATE OR REPLACE FUNCTION public.enforce_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active = true THEN RETURN NEW; END IF;
  v_count := (SELECT count(*) FROM public.company_users WHERE company_id = NEW.company_id AND is_active = true);
  PERFORM public.assert_subscription_limit(NEW.company_id, 'max_users', v_count, 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_user_subscription_limit ON public.company_users;
CREATE TRIGGER enforce_user_subscription_limit
  BEFORE INSERT OR UPDATE OF is_active ON public.company_users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

CREATE OR REPLACE FUNCTION public.enforce_resource_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint; v_code text;
BEGIN
  v_code := CASE TG_TABLE_NAME WHEN 'clients' THEN 'max_clients' ELSE 'max_products' END;
  v_count := CASE TG_TABLE_NAME
    WHEN 'clients' THEN (SELECT count(*) FROM public.clients WHERE company_id = NEW.company_id)
    ELSE (SELECT count(*) FROM public.products WHERE company_id = NEW.company_id)
  END;
  PERFORM public.assert_subscription_limit(NEW.company_id, v_code, v_count, 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_subscription_limit ON public.clients;
CREATE TRIGGER enforce_client_subscription_limit
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resource_limit();

DROP TRIGGER IF EXISTS enforce_product_subscription_limit ON public.products;
CREATE TRIGGER enforce_product_subscription_limit
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resource_limit();

GRANT EXECUTE ON FUNCTION public.subscription_feature_value(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_subscription_limit(uuid, text, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_subscription_feature(uuid, text) TO authenticated;
