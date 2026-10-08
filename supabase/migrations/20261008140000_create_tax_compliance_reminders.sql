-- Lembretes de obrigações fiscais (Modelo 30 / ISPC)
--
-- O contribuinte do ISPC tem de entregar a Declaração Modelo 30 e pagar o
-- imposto até ao último dia do mês seguinte ao trimestre:
--   1.º trimestre → 30/04 · 2.º → 31/07 · 3.º → 31/10 · 4.º → 31/01 do ano seguinte
--
-- Este motor gera, para cada empresa:
--   - lembretes a 15, 7 e 1 dia do fim do prazo (d15, d7, d1);
--   - um aviso de incumprimento quando o prazo passa sem a declaração estar
--     submetida ou paga (overdue), com indicação de multas e penalidades.
--
-- Cada lembrete fica em tax_reminders (histórico e fila de email) e é
-- espelhado em ai_alerts para aparecer no sino de notificações. O envio de
-- email é feito pela Edge Function `send-tax-reminders`.
--
-- Todas as empresas são tratadas como sujeitas ao ISPC.

CREATE TABLE IF NOT EXISTS public.tax_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  kind text NOT NULL CHECK (kind IN ('d15', 'd7', 'd1', 'overdue')),
  due_date date NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz,
  email_error text,
  CONSTRAINT tax_reminders_unique UNIQUE (company_id, year, quarter, kind)
);

CREATE INDEX IF NOT EXISTS idx_tax_reminders_company_created
  ON public.tax_reminders (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tax_reminders_pending_email
  ON public.tax_reminders (created_at)
  WHERE emailed_at IS NULL;

ALTER TABLE public.tax_reminders ENABLE ROW LEVEL SECURITY;

-- Só leitura para os membros da empresa; a escrita é exclusiva do motor
-- (funções SECURITY DEFINER e service_role).
DROP POLICY IF EXISTS "Company members read tax reminders" ON public.tax_reminders;
CREATE POLICY "Company members read tax reminders"
  ON public.tax_reminders FOR SELECT
  TO authenticated
  USING (public.ai_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- Texto das penalidades
-- ---------------------------------------------------------------------------
-- Mantido num único sítio para poder ser revisto por um especialista fiscal
-- sem mexer no motor. Não indica valores concretos de multas de propósito.

CREATE OR REPLACE FUNCTION public.tax_penalty_notice()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'A entrega da declaração fora do prazo e o pagamento tardio do imposto '
      || 'estão sujeitos a multas previstas no Regime Geral das Infracções Tributárias '
      || 'e a juros compensatórios nos termos da Lei Geral Tributária, que aumentam '
      || 'com o tempo de atraso. Recomendamos a regularização imediata junto da '
      || 'Área Fiscal da sua área de jurisdição: a regularização voluntária é, em '
      || 'regra, mais favorável do que aguardar a notificação da Autoridade Tributária.';
$$;

-- ---------------------------------------------------------------------------
-- Motor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_tax_reminders(
  p_reference_date date DEFAULT CURRENT_DATE,
  p_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Quantos trimestres para trás se verificam incumprimentos. Evita que uma
  -- empresa antiga, que nunca usou o módulo de impostos, receba dezenas de
  -- avisos de uma só vez.
  c_lookback constant integer := 4;

  v_ref date := COALESCE(p_reference_date, CURRENT_DATE);
  v_company record;
  v_first_quarter date;
  v_qs date;          -- início do trimestre
  v_due date;         -- prazo de entrega e pagamento
  v_year integer;
  v_quarter integer;
  v_days integer;
  v_kind text;
  v_title text;
  v_body text;
  v_severity text;
  v_dedupe text;
  v_id uuid;
  v_compliant boolean;
  v_count integer := 0;
  k integer;
BEGIN
  FOR v_company IN
    SELECT c.id, c.created_at
      FROM public.companies c
     WHERE COALESCE(c.status, 'active') <> 'suspended'
       AND (p_company_id IS NULL OR c.id = p_company_id)
  LOOP
    v_first_quarter := date_trunc('quarter', COALESCE(v_company.created_at, now())::timestamp)::date;

    FOR k IN 1..c_lookback LOOP
      v_qs := (date_trunc('quarter', v_ref::timestamp) - make_interval(months => 3 * k))::date;
      v_year := EXTRACT(YEAR FROM v_qs)::int;
      v_quarter := EXTRACT(QUARTER FROM v_qs)::int;
      -- Último dia do mês seguinte ao fim do trimestre.
      v_due := (v_qs + interval '4 months' - interval '1 day')::date;

      -- Trimestres anteriores à criação da empresa não contam.
      CONTINUE WHEN v_qs < v_first_quarter;

      SELECT EXISTS (
        SELECT 1 FROM public.tax_declarations d
         WHERE d.company_id = v_company.id
           AND d.year = v_year
           AND d.period = v_quarter
           AND d.status IN ('submetida', 'paga')
      ) INTO v_compliant;

      IF v_compliant THEN
        -- Obrigação cumprida: fecha os alertas que ainda estejam abertos.
        UPDATE public.ai_alerts a
           SET status = 'resolvida', resolved_at = now()
         WHERE a.company_id = v_company.id
           AND a.rule_code = 'lembrete_fiscal'
           AND a.status IN ('nova', 'lida')
           AND a.dedupe_key LIKE format('lembrete_fiscal:%s:T%s:%%', v_year, v_quarter);
        CONTINUE;
      END IF;

      v_days := v_due - v_ref;
      v_kind := NULL;

      IF v_days < 0 THEN
        v_kind := 'overdue';
      ELSIF v_days <= 1 THEN
        v_kind := 'd1';
      ELSIF v_days <= 7 THEN
        v_kind := 'd7';
      ELSIF v_days <= 15 THEN
        v_kind := 'd15';
      END IF;

      CONTINUE WHEN v_kind IS NULL;

      -- Recuperação: se um dia de execução falhar, emite-se o marco mais
      -- urgente já atingido. Os marcos menos urgentes que ficaram para trás
      -- não são emitidos (seriam redundantes).
      CONTINUE WHEN v_kind <> 'overdue' AND EXISTS (
        SELECT 1 FROM public.tax_reminders r
         WHERE r.company_id = v_company.id
           AND r.year = v_year AND r.quarter = v_quarter
           AND r.kind = ANY (CASE v_kind
                               WHEN 'd15' THEN ARRAY['d15', 'd7', 'd1']
                               WHEN 'd7'  THEN ARRAY['d7', 'd1']
                               ELSE ARRAY['d1'] END)
      );

      IF v_kind = 'overdue' THEN
        v_severity := 'critico';
        v_title := format('Incumprimento: Modelo 30 do %sº trimestre de %s em atraso',
                          v_quarter, v_year);
        v_body := format(
          'O prazo para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto terminou a %s. '
          || 'Não consta no sistema a submissão nem o pagamento desta declaração, pelo que a sua empresa se encontra em situação de incumprimento fiscal. ',
          v_quarter, v_year, to_char(v_due, 'DD/MM/YYYY')
        ) || public.tax_penalty_notice();
      ELSE
        v_severity := CASE v_kind WHEN 'd15' THEN 'info'
                                  WHEN 'd7'  THEN 'aviso'
                                  ELSE 'critico' END;
        IF v_days = 0 THEN
          v_title := format('Modelo 30: hoje é o último dia (%sº trimestre de %s)',
                            v_quarter, v_year);
          v_body := format(
            'Hoje é o último dia para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto. Prazo: %s.',
            v_quarter, v_year, to_char(v_due, 'DD/MM/YYYY'));
        ELSE
          v_title := format('Modelo 30: falta%s %s dia%s (%sº trimestre de %s)',
                            CASE WHEN v_days = 1 THEN '' ELSE 'm' END, v_days,
                            CASE WHEN v_days = 1 THEN '' ELSE 's' END,
                            v_quarter, v_year);
          v_body := format(
            'Falta%s %s dia%s para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto. Prazo: %s.',
            CASE WHEN v_days = 1 THEN '' ELSE 'm' END, v_days,
            CASE WHEN v_days = 1 THEN '' ELSE 's' END,
            v_quarter, v_year, to_char(v_due, 'DD/MM/YYYY'));
        END IF;
      END IF;

      v_id := NULL;
      INSERT INTO public.tax_reminders
        (company_id, year, quarter, kind, due_date, title, body)
      VALUES
        (v_company.id, v_year, v_quarter, v_kind, v_due, v_title, v_body)
      ON CONFLICT (company_id, year, quarter, kind) DO NOTHING
      RETURNING id INTO v_id;

      CONTINUE WHEN v_id IS NULL;  -- já emitido anteriormente
      v_count := v_count + 1;

      -- Um lembrete novo substitui os anteriores do mesmo trimestre no sino.
      UPDATE public.ai_alerts a
         SET status = 'resolvida', resolved_at = now()
       WHERE a.company_id = v_company.id
         AND a.rule_code = 'lembrete_fiscal'
         AND a.status IN ('nova', 'lida')
         AND a.dedupe_key LIKE format('lembrete_fiscal:%s:T%s:%%', v_year, v_quarter);

      v_dedupe := format('lembrete_fiscal:%s:T%s:%s', v_year, v_quarter, v_kind);

      -- Escrito directamente (e não só via generate_ai_alerts) para aparecer
      -- independentemente da funcionalidade ai_smart_alerts do plano.
      PERFORM public.ai_upsert_alert(
        v_company.id, 'lembrete_fiscal', v_dedupe, v_severity,
        v_title, v_body,
        jsonb_build_object('trimestre', v_quarter, 'ano', v_year,
                           'data_limite', v_due, 'tipo', v_kind,
                           'dias_restantes', v_days),
        CASE WHEN v_kind = 'overdue' THEN 'Regularizar' ELSE 'Ver Modelo 30' END,
        '/impostos'
      );
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tax_reminders(date, uuid) FROM public;
REVOKE ALL ON FUNCTION public.generate_tax_reminders(date, uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.generate_tax_reminders(date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tax_penalty_notice() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Envio de email a partir da base de dados (pg_net)
-- ---------------------------------------------------------------------------
-- Chama a Edge Function `send-tax-reminders`. O URL do projecto e o segredo
-- do cron são lidos do Supabase Vault (segredos 'project_url' e 'cron_secret')
-- ou, em alternativa, das definições app.settings.supabase_url e
-- app.settings.cron_secret. Sem eles, regista um aviso e não faz nada.
--
--   SELECT vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   SELECT vault.create_secret('<mesmo valor de CRON_SECRET>', 'cron_secret');

CREATE OR REPLACE FUNCTION public.dispatch_tax_reminder_emails()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  BEGIN
    EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1$q$
      INTO v_url;
    EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1$q$
      INTO v_secret;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- Vault indisponível: tenta as definições abaixo.
  END;

  v_url := COALESCE(NULLIF(v_url, ''), NULLIF(current_setting('app.settings.supabase_url', true), ''));
  v_secret := COALESCE(NULLIF(v_secret, ''), NULLIF(current_setting('app.settings.cron_secret', true), ''));

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'send-tax-reminders: falta project_url ou cron_secret (Vault ou app.settings).';
    RETURN NULL;
  END IF;

  EXECUTE
    'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 120000)'
    INTO v_request_id
    USING rtrim(v_url, '/') || '/functions/v1/send-tax-reminders',
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          '{}'::jsonb;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'send-tax-reminders: falha ao invocar a Edge Function (%).', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_tax_reminder_emails() FROM public;
REVOKE ALL ON FUNCTION public.dispatch_tax_reminder_emails() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_tax_reminder_emails() TO service_role;

-- ---------------------------------------------------------------------------
-- Agendamento diário (pg_cron, em UTC: 06:00 UTC = 08:00 em Maputo)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule('lembretes-fiscais-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembretes-fiscais-diario');

  PERFORM cron.schedule(
    'lembretes-fiscais-diario',
    '0 6 * * *',
    'SELECT public.generate_tax_reminders();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível (%). Agende a Edge Function send-tax-reminders externamente.', SQLERRM;
END $$;

-- O email segue 15 minutos depois, se o pg_net existir. Caso contrário, agende
-- externamente um POST para /functions/v1/send-tax-reminders com o cabeçalho
-- x-cron-secret (ver docs/LEMBRETES-FISCAIS.md).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.unschedule('lembretes-fiscais-email')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembretes-fiscais-email');

  PERFORM cron.schedule(
    'lembretes-fiscais-email',
    '15 6 * * *',
    'SELECT public.dispatch_tax_reminder_emails();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net/pg_cron indisponível (%). Agende o envio de email externamente.', SQLERRM;
END $$;
