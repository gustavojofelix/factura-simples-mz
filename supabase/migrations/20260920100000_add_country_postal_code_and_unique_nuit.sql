-- Área "Criar Conta": País e Código Postal na entidade, e NUIT único na plataforma.
--
-- O NUIT identifica uma entidade perante a Autoridade Tributária, pelo que não
-- pode ser partilhado por duas empresas — nem sequer de subscritores diferentes.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'Moçambique';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS postal_code text;

-- ── Normalização ────────────────────────────────────────────────────────────
-- O NUIT é guardado como 9 dígitos sem espaços nem separadores. Registos
-- antigos podem ter sido gravados com formatação, o que faria com que dois
-- NUITs iguais escapassem à restrição de unicidade.
UPDATE public.companies
   SET nuit = regexp_replace(nuit, '\D', '', 'g')
 WHERE nuit IS NOT NULL
   AND nuit <> regexp_replace(nuit, '\D', '', 'g');

-- ── Bloqueio de novos duplicados ────────────────────────────────────────────
-- O trigger protege a partir de já, mesmo que ainda existam duplicados
-- históricos que impeçam a criação do índice único mais abaixo.
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

  -- Em UPDATE, só validar quando o NUIT muda de facto.
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

-- ── Índice único ────────────────────────────────────────────────────────────
-- Só é criado se os dados actuais já o permitirem. Se existirem duplicados
-- históricos a migração NÃO falha (não queremos bloquear o deploy), mas deixa
-- um aviso explícito com os NUITs em conflito para serem resolvidos a seguir.
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
    RAISE NOTICE 'Índice único companies_nuit_unique criado.';
  ELSE
    RAISE WARNING 'Índice único do NUIT NÃO criado — existem duplicados por resolver: %', v_duplicates;
    RAISE WARNING 'O trigger enforce_company_nuit_unique já impede novos duplicados. Depois de limpar os registos acima, crie o índice manualmente.';
  END IF;
END $$;

-- ── Verificação prévia no formulário ────────────────────────────────────────
-- O RLS impede um subscritor de ver as empresas de outro, pelo que o cliente
-- não consegue detectar sozinho um NUIT já usado noutra conta. Esta função
-- devolve apenas um booleano — não revela a quem pertence o NUIT.
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
