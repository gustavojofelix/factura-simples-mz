-- Configurações > Sistema (public.system_settings)
--
-- 1. Backfill: garante uma linha por empresa. A tabela foi truncada uma vez
--    (20251219202534) e as empresas criadas antes do trigger create_company_owner
--    podiam ficar sem linha — a gravação na UI era então um no-op silencioso.
-- 2. Normaliza valores antigos e acrescenta validações:
--      language      → só 'pt' (a interface só existe em português);
--      date_format   → 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
--      timezone      → nome IANA válido (pg_timezone_names), via trigger;
--      notification_email → NULL ou endereço com formato de email.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Backfill
-- ---------------------------------------------------------------------------
INSERT INTO public.system_settings (company_id)
SELECT c.id
  FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Normalização dos dados existentes
-- ---------------------------------------------------------------------------
UPDATE public.system_settings
   SET language = 'pt'
 WHERE language IS DISTINCT FROM 'pt';

UPDATE public.system_settings
   SET date_format = 'DD/MM/YYYY'
 WHERE date_format IS NULL
    OR date_format NOT IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD');

UPDATE public.system_settings
   SET timezone = 'Africa/Maputo'
 WHERE timezone IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = system_settings.timezone);

UPDATE public.system_settings
   SET enable_notifications = true
 WHERE enable_notifications IS NULL;

UPDATE public.system_settings
   SET notification_email = NULLIF(btrim(notification_email), '')
 WHERE notification_email IS NOT NULL
   AND notification_email IS DISTINCT FROM NULLIF(btrim(notification_email), '');

UPDATE public.system_settings
   SET notification_email = NULL
 WHERE notification_email IS NOT NULL
   AND notification_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- ---------------------------------------------------------------------------
-- 3. Valores por omissão / NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_settings ALTER COLUMN language SET DEFAULT 'pt';
ALTER TABLE public.system_settings ALTER COLUMN language SET NOT NULL;
ALTER TABLE public.system_settings ALTER COLUMN date_format SET DEFAULT 'DD/MM/YYYY';
ALTER TABLE public.system_settings ALTER COLUMN date_format SET NOT NULL;
ALTER TABLE public.system_settings ALTER COLUMN timezone SET DEFAULT 'Africa/Maputo';
ALTER TABLE public.system_settings ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE public.system_settings ALTER COLUMN enable_notifications SET DEFAULT true;
ALTER TABLE public.system_settings ALTER COLUMN enable_notifications SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_language_check;
ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_language_check
  CHECK (language IN ('pt'));

ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_date_format_check;
ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_date_format_check
  CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'));

ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_notification_email_check;
ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_notification_email_check
  CHECK (notification_email IS NULL OR notification_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ---------------------------------------------------------------------------
-- 5. Fuso horário válido (um CHECK não pode consultar pg_timezone_names)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_system_settings_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.timezone IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name = NEW.timezone) THEN
    RAISE EXCEPTION 'Fuso horário inválido: %', NEW.timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_system_settings_timezone ON public.system_settings;
CREATE TRIGGER trg_validate_system_settings_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_system_settings_timezone();

COMMENT ON COLUMN public.system_settings.timezone IS
  'Fuso horário (IANA) usado para mostrar datas/horas na app, documentos, exportações e emails.';
COMMENT ON COLUMN public.system_settings.date_format IS
  'Formato de data da empresa: DD/MM/YYYY, MM/DD/YYYY ou YYYY-MM-DD. O Modelo 30 mantém sempre DD/MM/AAAA.';
COMMENT ON COLUMN public.system_settings.notification_email IS
  'Email acrescentado (sem duplicados) aos destinatários dos lembretes fiscais e das confirmações de subscrição.';
COMMENT ON COLUMN public.system_settings.enable_notifications IS
  'false: não envia lembretes fiscais por email (ficam cancelados com email_error=''desactivado''). Emails transaccionais continuam.';
COMMENT ON COLUMN public.system_settings.currency IS
  'Não usado pela aplicação (moeda é sempre MZN); oculto em Configurações.';
COMMENT ON COLUMN public.system_settings.fiscal_year_start IS
  'Não usado pela aplicação (ano fiscal = ano civil); oculto em Configurações.';
