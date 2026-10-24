import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Localized, normalizeLanguage, pick } from "../_shared/i18n.ts";

/**
 * Geração de alertas inteligentes.
 *
 * Dois modos:
 *
 *  - **Global** — chamado por um agendador externo com o cabeçalho
 *    `x-cron-secret`. Percorre todas as empresas com a funcionalidade activa.
 *    Só é necessário se o pg_cron não estiver disponível no projecto; a
 *    migração já tenta agendar `generate_ai_alerts_all()` directamente na base
 *    de dados, o que é mais barato e não depende desta função.
 *
 *  - **Por empresa** — chamado pela aplicação com o JWT do utilizador, quando
 *    este abre o painel de alertas e pede uma actualização. As funções em SQL
 *    revalidam o acesso.
 *
 * As regras vivem todas em SQL (`generate_ai_alerts`). Esta função não chama o
 * modelo: correr um LLM por empresa e por dia seria caro e daria resultados
 * diferentes a cada execução para os mesmos dados.
 *
 * Língua: o corpo pode trazer `language` ('pt-MZ' | 'en-GB' | 'fr-FR'), usado
 * nas mensagens de erro desta função. Os títulos/textos dos alertas são
 * gerados em SQL (português); a aplicação pode traduzi-los por `rule_code` e
 * `metric`.
 */

const MSG = {
  unauthenticated: {
    "pt-MZ": "Sessão não autenticada.",
    "en-GB": "You are not signed in.",
    "fr-FR": "Session non authentifiée.",
  },
  badRequest: {
    "pt-MZ": "Pedido inválido.",
    "en-GB": "Invalid request.",
    "fr-FR": "Requête invalide.",
  },
  missingCompany: {
    "pt-MZ": "Falta company_id.",
    "en-GB": "company_id is missing.",
    "fr-FR": "company_id manquant.",
  },
  invalidSession: {
    "pt-MZ": "Sessão inválida.",
    "en-GB": "Invalid session.",
    "fr-FR": "Session invalide.",
  },
  forbidden: {
    "pt-MZ": "Sem acesso a esta empresa.",
    "en-GB": "You do not have access to this company.",
    "fr-FR": "Vous n'avez pas accès à cette entreprise.",
  },
} satisfies Record<string, Localized>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const cronSecret = Deno.env.get("CRON_SECRET");
  const pedidoAgendado = cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  // --- Modo global ----------------------------------------------------------
  if (pedidoAgendado) {
    const adminClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await adminClient.rpc("generate_ai_alerts_all");
    if (error) {
      console.error("ai-alerts (global):", error.message);
      return json({ error: error.message }, 500);
    }
    return json(data);
  }

  // --- Modo por empresa -----------------------------------------------------
  let companyId: string | undefined;
  let language: unknown;
  try {
    ({ company_id: companyId, language } = await req.json());
  } catch {
    return json({ error: MSG.badRequest["pt-MZ"], code: "BAD_REQUEST" }, 400);
  }
  const lang = normalizeLanguage(language);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: pick(MSG.unauthenticated, lang), code: "UNAUTHENTICATED" }, 401);
  }

  if (!companyId) {
    return json({ error: pick(MSG.missingCompany, lang), code: "BAD_REQUEST" }, 400);
  }

  const userClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return json({ error: pick(MSG.invalidSession, lang), code: "UNAUTHENTICATED" }, 401);
  }

  // Fecha primeiro os alertas cujo motivo já desapareceu, para que uma factura
  // cobrada esta manhã não volte a aparecer como pendente.
  const { error: resolveError } = await userClient.rpc("ai_resolve_stale_alerts", {
    p_company_id: companyId,
  });
  if (resolveError) {
    return json({ error: pick(MSG.forbidden, lang), code: "FORBIDDEN" }, 403);
  }

  const { data, error } = await userClient.rpc("generate_ai_alerts", {
    p_company_id: companyId,
  });
  if (error) {
    console.error("ai-alerts (empresa):", error.message);
    return json({ error: error.message }, 500);
  }

  return json({ alertas_avaliados: data ?? 0 });
});
