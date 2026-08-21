-- Keep the database contract aligned with the billing cycles supported by the app.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS valid_billing_cycle;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT valid_billing_cycle
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'yearly'));

-- New subscriptions must use the stable plan identifier whenever available.
UPDATE public.subscriptions s
SET plan_id = p.id
FROM public.subscription_plans p
WHERE s.plan_id IS NULL
  AND (lower(trim(s.plan_name)) = lower(trim(p.name)) OR lower(trim(s.plan_name)) = lower(trim(p.code)));
