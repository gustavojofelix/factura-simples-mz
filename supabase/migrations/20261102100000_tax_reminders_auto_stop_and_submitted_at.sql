-- Impostos: lembretes param ao cumprir, podem ser dispensados, e a submissão
-- fica registada com data e hora.
--
--  1. tax_declarations.submitted_at: data/hora (servidor) em que a declaração
--     passou a «Submetida». Preenchida por trigger e imutável a partir do
--     cliente, para servir de comprovativo. Registos antigos são preenchidos a
--     partir do audit log ('Submeteu Declaração Fiscal'), quando existir.
--
--  2. Paragem imediata: quando uma declaração passa a submetida/paga, os
--     lembretes desse trimestre ainda na fila de email são cancelados e os
--     alertas do sino resolvidos no momento (antes só acontecia no cron diário).
--
--  3. tax_reminders.dismissed_at: o utilizador pode dispensar um lembrete na
--     página Impostos (RPC dismiss_tax_reminder). Deixa de aparecer, não segue
--     por email e o alerta correspondente do sino é resolvido.

-- ---------------------------------------------------------------------------
-- 1. Data/hora de submissão
-- ---------------------------------------------------------------------------

ALTER TABLE public.tax_declarations
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

COMMENT ON COLUMN public.tax_declarations.submitted_at IS
  'Data e hora (servidor) em que o estado passou a submetida. Definido por trigger; não pode ser alterado pelo cliente.';

CREATE OR REPLACE FUNCTION public.tax_declarations_track_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at := CASE WHEN NEW.status = 'submetida' THEN now() END;
  ELSIF NEW.status = 'submetida' AND OLD.status IS DISTINCT FROM 'submetida' THEN
    NEW.submitted_at := now();
  ELSE
    -- Mantém o registo original (também ao passar de submetida a paga).
    NEW.submitted_at := OLD.submitted_at;
  END IF;

  IF NEW.submitted_at IS NOT NULL AND NEW.submission_date IS NULL THEN
    NEW.submission_date := (NEW.submitted_at AT TIME ZONE 'Africa/Maputo')::date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_declarations_track_submission ON public.tax_declarations;
CREATE TRIGGER tax_declarations_track_submission
  BEFORE INSERT OR UPDATE ON public.tax_declarations
  FOR EACH ROW EXECUTE FUNCTION public.tax_declarations_track_submission();

-- Backfill a partir do audit log (o registo mais recente de submissão).
ALTER TABLE public.tax_declarations DISABLE TRIGGER tax_declarations_track_submission;

UPDATE public.tax_declarations d
   SET submitted_at = l.created_at
  FROM (
    SELECT DISTINCT ON (a.entity_id) a.entity_id, a.created_at
      FROM public.audit_logs a
     WHERE a.action = 'Submeteu Declaração Fiscal'
     ORDER BY a.entity_id, a.created_at DESC
  ) l
 WHERE d.submitted_at IS NULL
   AND d.status IN ('submetida', 'paga')
   AND l.entity_id = d.id::text;

ALTER TABLE public.tax_declarations ENABLE TRIGGER tax_declarations_track_submission;

-- ---------------------------------------------------------------------------
-- 2. Paragem imediata dos lembretes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tax_declarations_stop_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('submetida', 'paga') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('submetida', 'paga') THEN
    RETURN NEW;
  END IF;

  UPDATE public.tax_reminders t
     SET cancelled_at = now(),
         email_error = 'Cancelado: declaração submetida/paga'
   WHERE t.company_id = NEW.company_id
     AND t.year = NEW.year
     AND t.quarter = NEW.period
     AND t.emailed_at IS NULL
     AND t.cancelled_at IS NULL;

  UPDATE public.ai_alerts a
     SET status = 'resolvida', resolved_at = now()
   WHERE a.company_id = NEW.company_id
     AND a.rule_code = 'lembrete_fiscal'
     AND a.status IN ('nova', 'lida')
     AND a.dedupe_key LIKE format('lembrete_fiscal:%s:T%s:%%', NEW.year, NEW.period);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_declarations_stop_reminders ON public.tax_declarations;
CREATE TRIGGER tax_declarations_stop_reminders
  AFTER INSERT OR UPDATE OF status ON public.tax_declarations
  FOR EACH ROW EXECUTE FUNCTION public.tax_declarations_stop_reminders();

-- ---------------------------------------------------------------------------
-- 3. Dispensar lembretes
-- ---------------------------------------------------------------------------

ALTER TABLE public.tax_reminders
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tax_reminders.dismissed_at IS
  'Preenchido quando um utilizador dispensou o lembrete na página Impostos. Deixa de ser mostrado e não segue por email.';

CREATE OR REPLACE FUNCTION public.dismiss_tax_reminder(p_reminder_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reminder public.tax_reminders%ROWTYPE;
BEGIN
  SELECT * INTO v_reminder FROM public.tax_reminders WHERE id = p_reminder_id;

  IF NOT FOUND OR NOT public.ai_can_access_company(v_reminder.company_id) THEN
    RAISE EXCEPTION 'Lembrete não encontrado';
  END IF;

  UPDATE public.tax_reminders
     SET dismissed_at = COALESCE(dismissed_at, now()),
         dismissed_by = COALESCE(dismissed_by, auth.uid()),
         cancelled_at = CASE WHEN emailed_at IS NULL THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
         email_error = CASE WHEN emailed_at IS NULL AND cancelled_at IS NULL
                            THEN 'Dispensado pelo utilizador' ELSE email_error END
   WHERE id = p_reminder_id;

  UPDATE public.ai_alerts a
     SET status = 'resolvida', resolved_at = now()
   WHERE a.company_id = v_reminder.company_id
     AND a.rule_code = 'lembrete_fiscal'
     AND a.status IN ('nova', 'lida')
     AND a.dedupe_key = format('lembrete_fiscal:%s:T%s:%s',
                               v_reminder.year, v_reminder.quarter, v_reminder.kind);
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_tax_reminder(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_tax_reminder(uuid) TO authenticated, service_role;
