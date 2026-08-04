-- Catálogo configurável de tipos de actividades e respectivas regras fiscais.

CREATE TABLE IF NOT EXISTS public.activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.activity_types(id) ON DELETE RESTRICT,
  level smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity_type_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES public.activity_types(id) ON DELETE CASCADE,
  rule_type text NOT NULL DEFAULT 'ispc_rate',
  tax_rate numeric(5,2) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 100),
  minimum_amount numeric(14,2),
  maximum_amount numeric(14,2),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_rule_amounts_valid CHECK (
    maximum_amount IS NULL OR minimum_amount IS NULL OR maximum_amount >= minimum_amount
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_types_parent_id ON public.activity_types(parent_id);
CREATE INDEX IF NOT EXISTS idx_activity_types_active_order ON public.activity_types(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_activity_rules_activity_type ON public.activity_type_rules(activity_type_id);

ALTER TABLE public.activity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_type_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can view active activity types"
    ON public.activity_types FOR SELECT TO authenticated
    USING (is_active = true OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage activity types"
    ON public.activity_types FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can view active activity rules"
    ON public.activity_type_rules FOR SELECT TO authenticated
    USING (is_active = true OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage activity rules"
    ON public.activity_type_rules FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed do catálogo actualmente utilizado pelo frontend.
INSERT INTO public.activity_types (code, name, level, display_order) VALUES
  ('silvicola', 'Silvícola', 1, 10),
  ('pesqueira', 'Pesqueira', 1, 20),
  ('pecuaria', 'Pecuária', 1, 30),
  ('agricola', 'Agrícola', 1, 40),
  ('avicola', 'Avícola', 1, 50),
  ('apicola', 'Apícola', 1, 60),
  ('industrial', 'Industrial', 1, 70),
  ('comercial', 'Comercial', 1, 80)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level;

INSERT INTO public.activity_types (code, name, parent_id, level, display_order)
SELECT v.code, v.name, p.id, 2, v.display_order
FROM (VALUES
  ('comercializacao_agricola', 'Comercialização agrícola', 10),
  ('comercio_ambulante', 'Comércio ambulante', 20),
  ('comercio_geral', 'Comércio geral', 30),
  ('a_retalho_e_misto', 'A retalho e misto', 40),
  ('incluindo_em_bancas', 'Incluindo em bancas', 50),
  ('barracas', 'Barracas', 60),
  ('quiosques', 'Quiosques', 70),
  ('cantinas', 'Cantinas', 80),
  ('artesanato', 'Artesanato', 90),
  ('lojas', 'Lojas', 100),
  ('tendas', 'Tendas', 110),
  ('servicos_nao_liberais', 'Prestação de serviços não liberais', 120),
  ('servicos_liberais', 'Prestação de serviços liberais', 130)
) AS v(code, name, display_order)
CROSS JOIN (SELECT id FROM public.activity_types WHERE code = 'comercial') p
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, level = EXCLUDED.level;

INSERT INTO public.activity_types (code, name, parent_id, level, display_order)
SELECT v.code, v.name, p.id, 3, v.display_order
FROM (VALUES
  ('canalizacao', 'Canalização', 10, 'servicos_nao_liberais'),
  ('carpintaria', 'Carpintaria', 20, 'servicos_nao_liberais'),
  ('pedreiro', 'Pedreiro', 30, 'servicos_nao_liberais'),
  ('electricista', 'Electricista', 40, 'servicos_nao_liberais'),
  ('barbearia', 'Barbearia', 50, 'servicos_nao_liberais'),
  ('jardinagem', 'Jardinagem', 60, 'servicos_nao_liberais'),
  ('mecanica', 'Mecânica', 70, 'servicos_nao_liberais'),
  ('advogados', 'Advogados', 10, 'servicos_liberais'),
  ('economistas', 'Economistas', 20, 'servicos_liberais'),
  ('geologos', 'Geólogos', 30, 'servicos_liberais'),
  ('engenheiros', 'Engenheiros', 40, 'servicos_liberais'),
  ('contabilistas', 'Contabilistas', 50, 'servicos_liberais')
) AS v(code, name, display_order, parent_code)
JOIN public.activity_types p ON p.code = v.parent_code
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, level = EXCLUDED.level;

-- Regras iniciais correspondentes ao comportamento actual do cálculo do ISPC.
INSERT INTO public.activity_type_rules (activity_type_id, tax_rate)
SELECT id, CASE code
  WHEN 'servicos_nao_liberais' THEN 12
  WHEN 'servicos_liberais' THEN 15
  ELSE 3
END
FROM public.activity_types
WHERE level IN (1, 2)
  AND NOT EXISTS (
    SELECT 1 FROM public.activity_type_rules r
    WHERE r.activity_type_id = activity_types.id AND r.rule_type = 'ispc_rate'
  );

INSERT INTO public.activity_type_rules (activity_type_id, tax_rate)
SELECT child.id, parent_rule.tax_rate
FROM public.activity_types child
JOIN public.activity_types parent ON parent.id = child.parent_id
JOIN public.activity_type_rules parent_rule ON parent_rule.activity_type_id = parent.id
WHERE child.level = 3
  AND NOT EXISTS (
    SELECT 1 FROM public.activity_type_rules r
    WHERE r.activity_type_id = child.id AND r.rule_type = 'ispc_rate'
  );
