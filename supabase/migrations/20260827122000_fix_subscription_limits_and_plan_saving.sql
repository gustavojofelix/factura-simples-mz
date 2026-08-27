-- Fix missing plan features / entitlements for max_clients and max_products
-- Without these, users on any plan are blocked from creating clients and products.
INSERT INTO public.subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id, true, NULL
FROM public.subscription_plans p
CROSS JOIN public.subscription_features f
WHERE f.code IN ('max_clients', 'max_products')
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- Ensure all existing subscriptions have plan_id populated
UPDATE public.subscriptions s
SET plan_id = p.id
FROM public.subscription_plans p
WHERE s.plan_id IS NULL
  AND (lower(trim(s.plan_name)) = lower(trim(p.name)) OR lower(trim(s.plan_name)) = lower(trim(p.code)));

-- Modify create_company_owner to set plan_id for the initial Trial subscription
CREATE OR REPLACE FUNCTION create_company_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  -- Criar owner na tabela company_users
  INSERT INTO company_users (company_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner');

  -- Criar subscription com trial de 14 dias
  INSERT INTO subscriptions (
    company_id, 
    plan_name, 
    status, 
    billing_cycle, 
    amount, 
    start_date, 
    end_date,
    next_billing_date,
    plan_id
  )
  VALUES (
    NEW.id,
    'Trial',
    'trialing',
    'monthly',
    0,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '14 days',
    (SELECT id FROM public.subscription_plans WHERE code = 'trial' LIMIT 1)
  );

  -- Criar configurações do sistema
  INSERT INTO system_settings (company_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

-- Create helper function and trigger to auto-set plan_id if it's inserted/updated as NULL
CREATE OR REPLACE FUNCTION public.set_subscription_plan_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan_id IS NULL AND NEW.plan_name IS NOT NULL THEN
    NEW.plan_id := (
      SELECT id FROM public.subscription_plans 
       WHERE lower(trim(code)) = lower(trim(NEW.plan_name))
          OR lower(trim(name)) = lower(trim(NEW.plan_name))
       LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_subscription_plan_id ON public.subscriptions;
CREATE TRIGGER trg_set_subscription_plan_id
  BEFORE INSERT OR UPDATE OF plan_name, plan_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_subscription_plan_id();
