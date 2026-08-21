-- Subscription entitlements and limits
-- The old subscription_plans.features JSON remains for backwards compatibility
-- and presentation only. Enforcement uses this catalog and its typed values.

CREATE TABLE IF NOT EXISTS public.subscription_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  value_type text NOT NULL CHECK (value_type IN ('boolean', 'limit')),
  scope text NOT NULL CHECK (scope IN ('account', 'company')),
  unit text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_plan_features (
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.subscription_features(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  limit_value bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, feature_id),
  CONSTRAINT valid_feature_limit CHECK (limit_value IS NULL OR limit_value >= 0)
);

ALTER TABLE public.subscription_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active subscription features" ON public.subscription_features;
CREATE POLICY "Anyone can view active subscription features"
  ON public.subscription_features FOR SELECT
  USING (
    is_active = true OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins manage subscription features" ON public.subscription_features;
CREATE POLICY "Admins manage subscription features"
  ON public.subscription_features FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Anyone can view plan features" ON public.subscription_plan_features;
CREATE POLICY "Anyone can view plan features"
  ON public.subscription_plan_features FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscription_plans p
      WHERE p.id = subscription_plan_features.plan_id
        AND (p.is_active = true OR EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
        ))
    )
  );

DROP POLICY IF EXISTS "Admins manage plan features" ON public.subscription_plan_features;
CREATE POLICY "Admins manage plan features"
  ON public.subscription_plan_features FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

INSERT INTO public.subscription_features (code, name, description, value_type, scope, unit, sort_order)
VALUES
  ('invoicing', 'Emissão de facturas', 'Permite emitir facturas.', 'boolean', 'company', NULL, 10),
  ('email_invoices', 'Envio de facturas por email', 'Permite enviar facturas por email.', 'boolean', 'company', NULL, 20),
  ('reports', 'Relatórios', 'Permite consultar relatórios de gestão.', 'boolean', 'company', NULL, 30),
  ('tax_calculation', 'Cálculo automático de ISPC', 'Permite calcular automaticamente o ISPC.', 'boolean', 'company', NULL, 40),
  ('multiple_companies', 'Múltiplas empresas', 'Permite gerir mais de uma empresa.', 'boolean', 'account', NULL, 50),
  ('max_companies', 'Número máximo de empresas', 'Limite global de empresas do subscritor.', 'limit', 'account', 'empresas', 60),
  ('max_invoices_month', 'Facturas emitidas por mês', 'Limite de facturas emitidas no mês civil corrente.', 'limit', 'company', 'facturas/mês', 70),
  ('max_users', 'Utilizadores activos', 'Limite de utilizadores activos por empresa.', 'limit', 'company', 'utilizadores', 80),
  ('max_clients', 'Clientes', 'Limite de clientes por empresa.', 'limit', 'company', 'clientes', 90),
  ('max_products', 'Produtos e serviços', 'Limite de produtos e serviços por empresa.', 'limit', 'company', 'produtos', 100)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  scope = EXCLUDED.scope,
  unit = EXCLUDED.unit,
  updated_at = now();

-- Link existing plans to concrete entitlements. NULL limit_value means unlimited.
INSERT INTO public.subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id,
  CASE
    WHEN f.code = 'multiple_companies' AND p.code = 'essencial' THEN false
    ELSE true
  END,
  CASE
    WHEN f.code = 'max_companies' AND p.code = 'essencial' THEN 1
    WHEN f.code = 'max_companies' AND p.code = 'trial' THEN 1
    WHEN f.code = 'max_invoices_month' AND p.code = 'essencial' THEN 100
    WHEN f.code = 'max_users' AND p.code = 'essencial' THEN 1
    ELSE NULL
  END
FROM public.subscription_plans p
CROSS JOIN public.subscription_features f
WHERE p.code IN ('trial', 'essencial', 'profissional', 'standard')
  AND f.code IN ('invoicing', 'email_invoices', 'reports', 'tax_calculation', 'multiple_companies', 'max_companies', 'max_invoices_month', 'max_users')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  limit_value = EXCLUDED.limit_value,
  updated_at = now();

-- Future subscriptions can use the stable plan identifier. plan_name is retained
-- until all payment and legacy flows have been migrated.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.subscription_plans(id) ON DELETE RESTRICT;

UPDATE public.subscriptions s
SET plan_id = p.id
FROM public.subscription_plans p
WHERE s.plan_id IS NULL
  AND lower(trim(s.plan_name)) = lower(trim(p.name));

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plan_features_feature ON public.subscription_plan_features(feature_id);

-- Commercial defaults:
-- * quotas reset by calendar month;
-- * drafts and annulled invoices do not consume invoice quota;
-- * existing data is never deleted after downgrade;
-- * NULL limits are unlimited.
