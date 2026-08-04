-- Associa as empresas ao catálogo configurável de actividades.

CREATE TABLE IF NOT EXISTS public.company_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  activity_type_id uuid NOT NULL REFERENCES public.activity_types(id) ON DELETE RESTRICT,
  activity_role text NOT NULL DEFAULT 'comercial'
    CHECK (activity_role IN ('principal', 'comercial', 'servico')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_activities_unique_type UNIQUE (company_id, activity_type_id, activity_role)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_activities_one_primary
  ON public.company_activities(company_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_company_activities_company_id
  ON public.company_activities(company_id);

CREATE INDEX IF NOT EXISTS idx_company_activities_activity_type_id
  ON public.company_activities(activity_type_id);

ALTER TABLE public.company_activities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view activities of their companies"
    ON public.company_activities FOR SELECT TO authenticated
    USING (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_activities.company_id
        AND (c.user_id = auth.uid() OR public.is_company_member(c.id))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company owners can insert activities"
    ON public.company_activities FOR INSERT TO authenticated
    WITH CHECK (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_activities.company_id AND c.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company owners can update activities"
    ON public.company_activities FOR UPDATE TO authenticated
    USING (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_activities.company_id AND c.user_id = auth.uid()
      )
    )
    WITH CHECK (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_activities.company_id AND c.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company owners can delete activities"
    ON public.company_activities FOR DELETE TO authenticated
    USING (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = company_activities.company_id AND c.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Migração da actividade principal actual.
INSERT INTO public.company_activities (company_id, activity_type_id, activity_role, is_primary)
SELECT c.id, a.id, 'principal', true
FROM public.companies c
JOIN public.activity_types a ON a.code = lower(trim(c.category1))
WHERE c.category1 IS NOT NULL AND trim(c.category1) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.company_activities ca
    WHERE ca.company_id = c.id AND ca.activity_type_id = a.id AND ca.activity_role = 'principal'
  );

-- Migração da subcategoria actual. Serviços recebem o papel "servico";
-- as restantes subcategorias recebem o papel "comercial".
INSERT INTO public.company_activities (company_id, activity_type_id, activity_role, is_primary)
SELECT c.id, a.id,
  CASE WHEN a.code IN ('servicos_liberais', 'servicos_nao_liberais') THEN 'servico' ELSE 'comercial' END,
  false
FROM public.companies c
JOIN public.activity_types a ON a.code = lower(trim(c.category2))
JOIN public.activity_types parent ON parent.id = a.parent_id
WHERE c.category2 IS NOT NULL AND trim(c.category2) <> ''
  AND (c.category1 IS NULL OR parent.code = lower(trim(c.category1)))
  AND NOT EXISTS (
    SELECT 1 FROM public.company_activities ca
    WHERE ca.company_id = c.id AND ca.activity_type_id = a.id
  );

-- Migração das actividades específicas, incluindo os nomes apresentados
-- pela versão anterior do formulário.
INSERT INTO public.company_activities (company_id, activity_type_id, activity_role, is_primary)
SELECT c.id, a.id,
  CASE WHEN c.category2 IN ('servicos_liberais', 'servicos_nao_liberais') THEN 'servico' ELSE 'comercial' END,
  false
FROM public.companies c
JOIN public.activity_types a ON a.code = CASE lower(trim(c.category3))
  WHEN 'canalizacao' THEN 'canalizacao'
  WHEN 'canalização' THEN 'canalizacao'
  WHEN 'carpintaria' THEN 'carpintaria'
  WHEN 'pedreiro' THEN 'pedreiro'
  WHEN 'electricista' THEN 'electricista'
  WHEN 'barbearia' THEN 'barbearia'
  WHEN 'jardinagem' THEN 'jardinagem'
  WHEN 'mecanica' THEN 'mecanica'
  WHEN 'mecânica' THEN 'mecanica'
  WHEN 'advogados' THEN 'advogados'
  WHEN 'economistas' THEN 'economistas'
  WHEN 'geologos' THEN 'geologos'
  WHEN 'geólogos' THEN 'geologos'
  WHEN 'engenheiros' THEN 'engenheiros'
  WHEN 'contabilistas' THEN 'contabilistas'
  ELSE lower(trim(c.category3))
END
JOIN public.activity_types parent ON parent.id = a.parent_id
WHERE c.category3 IS NOT NULL AND trim(c.category3) <> ''
  AND (c.category2 IS NULL OR parent.code = lower(trim(c.category2)))
  AND NOT EXISTS (
    SELECT 1 FROM public.company_activities ca
    WHERE ca.company_id = c.id AND ca.activity_type_id = a.id
  );
