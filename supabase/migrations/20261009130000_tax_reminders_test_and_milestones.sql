-- Lembretes fiscais: novos marcos, cancelamento e simulação sem efeitos
--
-- Complementa 20261008140000_create_tax_compliance_reminders.sql:
--
--  1. Dois marcos novos, para cumprir o pedido "no fim do trimestre e na data
--     limite de pagamento":
--       qend → no dia seguinte ao fim do trimestre (1.º dia do trimestre novo);
--       d0   → no próprio dia do prazo.
--     Mantêm-se d15, d7, d1 e overdue. O prazo legal é mantido mesmo quando
--     calha num fim-de-semana; o texto do lembrete passa a assinalá-lo.
--
--  2. tax_reminders.cancelled_at: lembretes que já não devem ser enviados por
--     email (trimestre regularizado, backlog inicial, lembrete substituído).
--     Continuam visíveis na aplicação como histórico.
--
--  3. compute_tax_reminders(data, empresa): calcula, SEM escrever nada, os
--     lembretes que o motor emitiria numa data. É a base do modo 'preview' e
--     'test' da Edge Function send-tax-reminders (datas simuladas nunca chegam
--     a clientes reais nem ficam registadas).
--
--  4. generate_tax_reminders passa a usar compute_tax_reminders (mesma
--     assinatura; o pg_cron continua igual) e cancela os emails ainda na fila
--     de trimestres entretanto submetidos/pagos.
--
--  5. Cancela o backlog histórico (prazos anteriores a 01/10/2026) criado pela
--     primeira execução, para não ser enviado quando o SMTP ficar configurado.

-- ---------------------------------------------------------------------------
-- 1 e 2. Estrutura
-- ---------------------------------------------------------------------------

ALTER TABLE public.tax_reminders
  DROP CONSTRAINT IF EXISTS tax_reminders_kind_check;

ALTER TABLE public.tax_reminders
  ADD CONSTRAINT tax_reminders_kind_check
  CHECK (kind IN ('qend', 'd15', 'd7', 'd1', 'd0', 'overdue'));

ALTER TABLE public.tax_reminders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN public.tax_reminders.cancelled_at IS
  'Preenchido quando o lembrete deixou de dever ser enviado por email (trimestre regularizado, backlog inicial, substituído por outro mais urgente). O motivo fica em email_error.';

DROP INDEX IF EXISTS public.idx_tax_reminders_pending_email;
CREATE INDEX IF NOT EXISTS idx_tax_reminders_pending_email
  ON public.tax_reminders (created_at)
  WHERE emailed_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- Texto dos lembretes (único sítio)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.tax_reminder_text(text, integer, integer, date, integer);

CREATE FUNCTION public.tax_reminder_text(
  p_kind text,
  p_year integer,
  p_quarter integer,
  p_due date,
  p_days integer
)
RETURNS TABLE (title text, body text, severity text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_due_txt text := to_char(p_due, 'DD/MM/YYYY');
  v_dow integer := EXTRACT(ISODOW FROM p_due)::int;
  v_weekend_note text := '';
  v_days integer := GREATEST(COALESCE(p_days, 0), 0);
BEGIN
  -- O prazo legal mantém-se mesmo ao fim-de-semana; só se avisa.
  IF v_dow IN (6, 7) THEN
    v_weekend_note := format(
      ' Nota: o prazo legal (%s) calha num %s. Como os serviços e os bancos podem estar encerrados, recomendamos tratar da entrega e do pagamento até ao último dia útil anterior.',
      v_due_txt, CASE v_dow WHEN 6 THEN 'sábado' ELSE 'domingo' END);
  END IF;

  IF p_kind = 'overdue' THEN
    severity := 'critico';
    title := format('Incumprimento: Modelo 30 do %sº trimestre de %s em atraso', p_quarter, p_year);
    body := format(
      'O prazo para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto terminou a %s. '
      || 'Não consta no sistema a submissão nem o pagamento desta declaração, pelo que a sua empresa se encontra em situação de incumprimento fiscal. ',
      p_quarter, p_year, v_due_txt
    ) || public.tax_penalty_notice();

  ELSIF p_kind = 'qend' THEN
    severity := 'info';
    title := format('Fim do %sº trimestre de %s: entregue o Modelo 30 e pague o ISPC até %s',
                    p_quarter, p_year, v_due_txt);
    body := format(
      'Terminou o %sº trimestre de %s. Tem até %s para entregar a Declaração Modelo 30 (ISPC) deste trimestre e pagar o imposto. '
      || 'Pode calcular o imposto e preparar a declaração na área de Impostos.',
      p_quarter, p_year, v_due_txt) || v_weekend_note;

  ELSIF p_kind = 'd0' THEN
    severity := 'critico';
    title := format('Modelo 30: hoje é o último dia (%sº trimestre de %s)', p_quarter, p_year);
    body := format(
      'Hoje é o último dia para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto. Prazo: %s.',
      p_quarter, p_year, v_due_txt) || v_weekend_note;

  ELSE
    -- d15, d7, d1
    severity := CASE p_kind WHEN 'd15' THEN 'info' WHEN 'd7' THEN 'aviso' ELSE 'critico' END;
    title := format('Modelo 30: falta%s %s dia%s (%sº trimestre de %s)',
                    CASE WHEN v_days = 1 THEN '' ELSE 'm' END, v_days,
                    CASE WHEN v_days = 1 THEN '' ELSE 's' END,
                    p_quarter, p_year);
    body := format(
      'Falta%s %s dia%s para entregar a Declaração Modelo 30 (ISPC) do %sº trimestre de %s e pagar o imposto. Prazo: %s.',
      CASE WHEN v_days = 1 THEN '' ELSE 'm' END, v_days,
      CASE WHEN v_days = 1 THEN '' ELSE 's' END,
      p_quarter, p_year, v_due_txt) || v_weekend_note;
  END IF;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cálculo sem efeitos
-- ---------------------------------------------------------------------------
-- Devolve o marco atingido em p_reference_date para cada trimestre em aberto
-- (até 4 trimestres para trás) de cada empresa não suspensa. Não escreve nada.
--
-- already_issued = já existe em tax_reminders este marco ou um mais urgente do
-- mesmo trimestre (nesse caso o motor não o emitiria).
--
-- Regras (dias = prazo - data):
--   < 0 → overdue · = 0 → d0 · = 1 → d1 · ≤ 7 → d7 · ≤ 15 → d15
--   > 15 e trimestre acabado de fechar → qend
-- Recuperação: se um dia de execução falhar, emite-se o marco mais urgente já
-- atingido; os menos urgentes ficam suprimidos.

DROP FUNCTION IF EXISTS public.compute_tax_reminders(date, uuid);

CREATE FUNCTION public.compute_tax_reminders(
  p_reference_date date DEFAULT CURRENT_DATE,
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  year integer,
  quarter integer,
  kind text,
  due_date date,
  days_left integer,
  title text,
  body text,
  severity text,
  already_issued boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_lookback constant integer := 4;

  v_ref date := COALESCE(p_reference_date, CURRENT_DATE);
  v_company record;
  v_text record;
  v_first_quarter date;
  v_qs date;
  v_due date;
  v_year integer;
  v_quarter integer;
  v_days integer;
  v_kind text;
  v_supersede text[];
  k integer;
BEGIN
  FOR v_company IN
    SELECT c.id, c.created_at
      FROM public.companies c
     WHERE COALESCE(c.status, 'active') <> 'suspended'
       AND (p_company_id IS NULL OR c.id = p_company_id)
     ORDER BY c.id
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

      -- Trimestre cumprido: nada a lembrar.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.tax_declarations d
         WHERE d.company_id = v_company.id
           AND d.year = v_year
           AND d.period = v_quarter
           AND d.status IN ('submetida', 'paga')
      );

      v_days := v_due - v_ref;
      v_kind := CASE
                  WHEN v_days < 0 THEN 'overdue'
                  WHEN v_days = 0 THEN 'd0'
                  WHEN v_days = 1 THEN 'd1'
                  WHEN v_days <= 7 THEN 'd7'
                  WHEN v_days <= 15 THEN 'd15'
                  WHEN k = 1 THEN 'qend'
                END;

      CONTINUE WHEN v_kind IS NULL;

      v_supersede := CASE v_kind
                       WHEN 'qend' THEN ARRAY['qend', 'd15', 'd7', 'd1', 'd0']
                       WHEN 'd15'  THEN ARRAY['d15', 'd7', 'd1', 'd0']
                       WHEN 'd7'   THEN ARRAY['d7', 'd1', 'd0']
                       WHEN 'd1'   THEN ARRAY['d1', 'd0']
                       ELSE ARRAY[v_kind]
                     END;

      SELECT t.title, t.body, t.severity INTO v_text
        FROM public.tax_reminder_text(v_kind, v_year, v_quarter, v_due, v_days) t;

      company_id := v_company.id;
      year := v_year;
      quarter := v_quarter;
      kind := v_kind;
      due_date := v_due;
      days_left := v_days;
      title := v_text.title;
      body := v_text.body;
      severity := v_text.severity;
      already_issued := EXISTS (
        SELECT 1 FROM public.tax_reminders r
         WHERE r.company_id = v_company.id
           AND r.year = v_year
           AND r.quarter = v_quarter
           AND r.kind = ANY (v_supersede)
      );
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Motor (mesma assinatura)
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
  -- Prazos anteriores ao 3.º trimestre de 2026 (backlog inicial) ficam
  -- registados e visíveis na aplicação, mas nunca seguem por email: são
  -- inseridos já cancelados. Vale para qualquer execução futura (cron em
  -- falta, empresa reactivada, outro ambiente), não só para a fila actual.
  c_email_cutoff constant date := DATE '2026-10-01';

  v_ref date := COALESCE(p_reference_date, CURRENT_DATE);
  r record;
  v_id uuid;
  v_dedupe text;
  v_count integer := 0;
BEGIN
  -- Trimestres regularizados: os emails ainda na fila deixam de ser enviados
  -- e os alertas abertos do sino são resolvidos.
  UPDATE public.tax_reminders t
     SET cancelled_at = now(),
         email_error = 'Cancelado: declaração submetida/paga'
   WHERE t.emailed_at IS NULL
     AND t.cancelled_at IS NULL
     AND (p_company_id IS NULL OR t.company_id = p_company_id)
     AND EXISTS (
       SELECT 1 FROM public.tax_declarations d
        WHERE d.company_id = t.company_id
          AND d.year = t.year
          AND d.period = t.quarter
          AND d.status IN ('submetida', 'paga')
     );

  UPDATE public.ai_alerts a
     SET status = 'resolvida', resolved_at = now()
   WHERE a.rule_code = 'lembrete_fiscal'
     AND a.status IN ('nova', 'lida')
     AND (p_company_id IS NULL OR a.company_id = p_company_id)
     AND EXISTS (
       SELECT 1 FROM public.tax_declarations d
        WHERE d.company_id = a.company_id
          AND d.status IN ('submetida', 'paga')
          AND a.dedupe_key LIKE format('lembrete_fiscal:%s:T%s:%%', d.year, d.period)
     );

  FOR r IN
    SELECT * FROM public.compute_tax_reminders(v_ref, p_company_id) c
     WHERE NOT c.already_issued
  LOOP
    v_id := NULL;
    INSERT INTO public.tax_reminders
      (company_id, year, quarter, kind, due_date, title, body, cancelled_at, email_error)
    VALUES
      (r.company_id, r.year, r.quarter, r.kind, r.due_date, r.title, r.body,
       CASE WHEN r.due_date < c_email_cutoff THEN now() END,
       CASE WHEN r.due_date < c_email_cutoff THEN 'Backlog inicial não enviado' END)
    ON CONFLICT (company_id, year, quarter, kind) DO NOTHING
    RETURNING id INTO v_id;

    CONTINUE WHEN v_id IS NULL;  -- já emitido anteriormente
    v_count := v_count + 1;

    -- Um lembrete novo substitui os anteriores do mesmo trimestre no sino.
    UPDATE public.ai_alerts a
       SET status = 'resolvida', resolved_at = now()
     WHERE a.company_id = r.company_id
       AND a.rule_code = 'lembrete_fiscal'
       AND a.status IN ('nova', 'lida')
       AND a.dedupe_key LIKE format('lembrete_fiscal:%s:T%s:%%', r.year, r.quarter);

    v_dedupe := format('lembrete_fiscal:%s:T%s:%s', r.year, r.quarter, r.kind);

    PERFORM public.ai_upsert_alert(
      r.company_id, 'lembrete_fiscal', v_dedupe, r.severity,
      r.title, r.body,
      jsonb_build_object('trimestre', r.quarter, 'ano', r.year,
                         'data_limite', r.due_date, 'tipo', r.kind,
                         'dias_restantes', r.days_left),
      CASE WHEN r.kind = 'overdue' THEN 'Regularizar' ELSE 'Ver Modelo 30' END,
      '/impostos'
    );
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tax_reminder_text(text, integer, integer, date, integer) FROM public;
REVOKE ALL ON FUNCTION public.tax_reminder_text(text, integer, integer, date, integer) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.tax_reminder_text(text, integer, integer, date, integer) TO service_role;

REVOKE ALL ON FUNCTION public.compute_tax_reminders(date, uuid) FROM public;
REVOKE ALL ON FUNCTION public.compute_tax_reminders(date, uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.compute_tax_reminders(date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.generate_tax_reminders(date, uuid) FROM public;
REVOKE ALL ON FUNCTION public.generate_tax_reminders(date, uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.generate_tax_reminders(date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Backlog histórico (uma vez; idempotente)
-- ---------------------------------------------------------------------------
-- A primeira execução diária (08/10/2026) criou avisos de incumprimento para
-- trimestres antigos (4.º/2025 a 2.º/2026). Ficaram na fila só porque o SMTP
-- não estava configurado. Não são enviados por email; continuam visíveis na
-- página Impostos e no sino. Só os prazos a partir do 3.º trimestre de 2026
-- (31/10/2026) seguem por email. O mesmo corte está no motor
-- (generate_tax_reminders insere estes prazos já cancelados) e na Edge
-- Function (modo 'run' cancela-os se os encontrar na fila); este UPDATE só
-- trata das linhas que já existem.

UPDATE public.tax_reminders
   SET cancelled_at = now(),
       email_error = 'Backlog inicial não enviado'
 WHERE emailed_at IS NULL
   AND cancelled_at IS NULL
   AND due_date < DATE '2026-10-01';
