-- Migration: Atualização de Campos da Empresa e Garantia de NUIT Único
-- Data: 2026-09-25
-- Descrição:
-- 1. Adiciona os campos country (País, padrão 'Moçambique') e postal_code (Código Postal) na tabela public.companies.
-- 2. Cria a função e trigger de verificação de NUIT único na plataforma.
-- 3. Cria a função RPC (is_company_nuit_available) para validação prévia no formulário do cliente.

-- 1. Adição de Colunas
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'Moçambique';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS postal_code text;

-- 2. Normalização dos NUITs existentes (remove caracteres não numéricos)
UPDATE public.companies
   SET nuit = regexp_replace(nuit, '\D', '', 'g')
 WHERE nuit IS NOT NULL
   AND nuit <> regexp_replace(nuit, '\D', '', 'g');

-- 3. Função e Trigger para Impossibilitar NUIT Duplicado na Inserção/Atualização
CREATE OR REPLACE FUNCTION public.enforce_unique_company_nuit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuit text;
  v_owner text;
BEGIN
  v_nuit := regexp_replace(COALESCE(NEW.nuit, ''), '\D', '', 'g');

  IF v_nuit = '' THEN
    RETURN NEW;
  END IF;

  NEW.nuit := v_nuit;

  -- Em UPDATE, só validar se o NUIT sofreu alteração
  IF TG_OP = 'UPDATE' AND regexp_replace(COALESCE(OLD.nuit, ''), '\D', '', 'g') = v_nuit THEN
    RETURN NEW;
  END IF;

  SELECT c.name INTO v_owner
    FROM public.companies c
   WHERE regexp_replace(COALESCE(c.nuit, ''), '\D', '', 'g') = v_nuit
     AND c.id IS DISTINCT FROM NEW.id
   LIMIT 1;

  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe uma entidade registada com o NUIT %.', v_nuit
      USING ERRCODE = 'P0001', DETAIL = 'DUPLICATE_COMPANY_NUIT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_company_nuit_unique ON public.companies;
CREATE TRIGGER enforce_company_nuit_unique
  BEFORE INSERT OR UPDATE OF nuit ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_company_nuit();

-- 4. Índice Único no NUIT (se não existirem duplicados na base)
DO $$
DECLARE
  v_duplicates text;
BEGIN
  SELECT string_agg(nuit || ' (' || cnt || ' empresas)', ', ')
    INTO v_duplicates
    FROM (
      SELECT nuit, count(*) AS cnt
        FROM public.companies
       WHERE nuit IS NOT NULL AND nuit <> ''
       GROUP BY nuit
      HAVING count(*) > 1
    ) d;

  IF v_duplicates IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS companies_nuit_unique
      ON public.companies (nuit)
      WHERE nuit IS NOT NULL AND nuit <> '';
    RAISE NOTICE 'Índice único companies_nuit_unique criado com sucesso.';
  ELSE
    RAISE WARNING 'Aviso: Existem duplicados de NUIT a resolver antes de criar o índice único: %', v_duplicates;
  END IF;
END $$;

-- 5. Função RPC para Verificação Prévia de Disponibilidade de NUIT via API Client
CREATE OR REPLACE FUNCTION public.is_company_nuit_available(
  p_nuit text,
  p_exclude_company_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.companies c
     WHERE regexp_replace(COALESCE(c.nuit, ''), '\D', '', 'g')
           = regexp_replace(COALESCE(p_nuit, ''), '\D', '', 'g')
       AND regexp_replace(COALESCE(p_nuit, ''), '\D', '', 'g') <> ''
       AND (p_exclude_company_id IS NULL OR c.id <> p_exclude_company_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_company_nuit_available(text, uuid) TO authenticated;

COMMENT ON COLUMN public.companies.country IS 'País da sede da entidade.';
COMMENT ON COLUMN public.companies.postal_code IS 'Código postal da sede da entidade.';
