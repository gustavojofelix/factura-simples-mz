-- Assistente Virtual (IA) — núcleo
-- Conversas, mensagens, contabilização de consumo e ligação ao catálogo de
-- funcionalidades por plano. As funções de análise vivem numa migração separada.

-- Predicado único de acesso: dono da empresa ou membro convidado.
CREATE OR REPLACE FUNCTION public.ai_can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies c
     WHERE c.id = p_company_id AND c.user_id = auth.uid()
  ) OR public.is_company_member(p_company_id);
$$;

-- ---------------------------------------------------------------------------
-- Conversas e mensagens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversa',
  is_archived boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_company
  ON public.ai_conversations (company_id, user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Texto visível ao utilizador.
  content text NOT NULL DEFAULT '',
  -- Blocos completos devolvidos pelo modelo (texto, tool_use, thinking).
  -- Guardados para reconstruir o histórico exactamente como a API o exige.
  blocks jsonb,
  -- Resumo das ferramentas invocadas, para auditoria e para a UI mostrar a
  -- proveniência dos números ("calculado a partir de 12 facturas").
  tool_calls jsonb,
  -- Dados estruturados que a UI renderiza (tabelas, séries de gráfico).
  attachments jsonb,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON public.ai_messages (conversation_id, created_at);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Cada utilizador vê apenas as suas próprias conversas, mesmo dentro da empresa:
-- perguntas de negócio podem revelar intenções que não devem circular na equipa.
DROP POLICY IF EXISTS "Users manage own AI conversations" ON public.ai_conversations;
CREATE POLICY "Users manage own AI conversations"
  ON public.ai_conversations FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.ai_can_access_company(company_id))
  WITH CHECK (user_id = auth.uid() AND public.ai_can_access_company(company_id));

DROP POLICY IF EXISTS "Users manage own AI messages" ON public.ai_messages;
CREATE POLICY "Users manage own AI messages"
  ON public.ai_messages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
       WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
       WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Consumo e quotas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  -- 'chat' | 'search' | 'report' | 'alerts'
  surface text NOT NULL DEFAULT 'chat',
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_company_month
  ON public.ai_usage_events (company_id, created_at DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Leitura para a empresa (para a UI mostrar "23 de 100 perguntas usadas");
-- a escrita pertence à Edge Function, que usa a service role.
DROP POLICY IF EXISTS "Company members read AI usage" ON public.ai_usage_events;
CREATE POLICY "Company members read AI usage"
  ON public.ai_usage_events FOR SELECT
  TO authenticated
  USING (public.ai_can_access_company(company_id) OR public.is_admin());

-- ---------------------------------------------------------------------------
-- Catálogo de funcionalidades
-- ---------------------------------------------------------------------------

INSERT INTO public.subscription_features (code, name, description, value_type, scope, unit, sort_order)
VALUES
  ('ai_assistant', 'Assistente Virtual (IA)',
   'Permite usar o assistente de IA para perguntas sobre o negócio e apoio fiscal.',
   'boolean', 'company', NULL, 110),
  ('max_ai_messages_month', 'Perguntas ao Assistente por mês',
   'Limite de perguntas ao assistente no mês civil corrente.',
   'limit', 'company', 'perguntas/mês', 120),
  ('ai_smart_alerts', 'Alertas inteligentes',
   'Gera alertas automáticos sobre cobranças, prazos fiscais e clientes inactivos.',
   'boolean', 'company', NULL, 130)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  scope = EXCLUDED.scope,
  unit = EXCLUDED.unit,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Limites por plano. NULL em limit_value significa ilimitado.
INSERT INTO public.subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id,
  CASE
    WHEN f.code = 'ai_smart_alerts' AND p.code IN ('trial', 'essencial') THEN false
    ELSE true
  END,
  CASE
    WHEN f.code = 'max_ai_messages_month' AND p.code = 'trial'        THEN 30
    WHEN f.code = 'max_ai_messages_month' AND p.code = 'essencial'    THEN 100
    WHEN f.code = 'max_ai_messages_month' AND p.code = 'profissional' THEN 500
    ELSE NULL
  END
FROM public.subscription_plans p
CROSS JOIN public.subscription_features f
WHERE p.code IN ('trial', 'essencial', 'profissional', 'standard')
  AND f.code IN ('ai_assistant', 'max_ai_messages_month', 'ai_smart_alerts')
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Quota: estado e verificação
-- ---------------------------------------------------------------------------

-- Só contam perguntas do utilizador; as respostas do assistente e as chamadas
-- internas de ferramentas não consomem quota.
CREATE OR REPLACE FUNCTION public.ai_messages_used_this_month(p_company_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
    FROM public.ai_usage_events e
   WHERE e.company_id = p_company_id
     AND e.surface = 'chat'
     AND e.created_at >= date_trunc('month', now());
$$;

-- Estado da quota para a UI. Devolve sempre uma linha.
CREATE OR REPLACE FUNCTION public.ai_quota_status(p_company_id uuid)
RETURNS TABLE(enabled boolean, used bigint, limit_value bigint, alerts_enabled boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_limit bigint;
  v_alerts boolean;
BEGIN
  IF NOT public.ai_can_access_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT fv.enabled INTO v_enabled
    FROM public.subscription_feature_value(p_company_id, 'ai_assistant') fv;

  SELECT fv.limit_value INTO v_limit
    FROM public.subscription_feature_value(p_company_id, 'max_ai_messages_month') fv;

  SELECT fv.enabled INTO v_alerts
    FROM public.subscription_feature_value(p_company_id, 'ai_smart_alerts') fv;

  RETURN QUERY SELECT
    COALESCE(v_enabled, false),
    public.ai_messages_used_this_month(p_company_id),
    v_limit,
    COALESCE(v_alerts, false);
END;
$$;

-- Guarda autoritária, chamada pela Edge Function antes de contactar o modelo.
-- Lança excepção quando a funcionalidade está desligada ou a quota esgotada.
CREATE OR REPLACE FUNCTION public.ai_assert_quota(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_limit bigint;
  v_used bigint;
BEGIN
  SELECT fv.enabled INTO v_enabled
    FROM public.subscription_feature_value(p_company_id, 'ai_assistant') fv;

  IF COALESCE(v_enabled, false) = false THEN
    RAISE EXCEPTION 'O Assistente Virtual não está disponível no seu plano.'
      USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_FEATURE_DISABLED';
  END IF;

  SELECT fv.limit_value INTO v_limit
    FROM public.subscription_feature_value(p_company_id, 'max_ai_messages_month') fv;

  IF v_limit IS NOT NULL THEN
    v_used := public.ai_messages_used_this_month(p_company_id);
    IF v_used >= v_limit THEN
      RAISE EXCEPTION 'Atingiu o limite de % perguntas ao assistente neste mês.', v_limit
        USING ERRCODE = 'P0001', DETAIL = 'SUBSCRIPTION_LIMIT_REACHED';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assert_quota(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ai_assert_quota(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_quota_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_can_access_company(uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS update_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER update_ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
