import "@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { SYSTEM_PROMPT, buildContextBlock } from "./prompt.ts";
import { TOOL_DEFINITIONS, executeTool, type ToolCallRecord } from "./tools.ts";
import {
  type EmailLanguage,
  getUserLanguage,
  type Localized,
  normalizeLanguage,
  pick,
} from "../_shared/i18n.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-opus-5";

/**
 * Tecto de segurança para o ciclo de ferramentas. Nenhuma pergunta legítima
 * precisa de mais do que isto; o limite existe para que um ciclo patológico não
 * consuma a quota do subscritor.
 */
const MAX_TURNS = 6;

/** Mensagens de histórico reenviadas a cada pedido. */
const HISTORY_LIMIT = 20;

/** Intervalo dos comentários SSE que mantêm a ligação viva. */
const KEEPALIVE_MS = 15_000;

// Preços do Claude Opus 5, por milhão de tokens. Usados apenas para registar
// custo estimado por empresa no backoffice.
const PRICE_INPUT = 5.0;
const PRICE_OUTPUT = 25.0;
const PRICE_CACHE_READ = 0.5;
// A escrita em cache custa 1,25× o preço de entrada.
const PRICE_CACHE_WRITE = 6.25;

/**
 * Fallback do lado do servidor: se o modelo recusar por política, a API repete
 * o mesmo pedido noutro modelo dentro da mesma chamada. Se a versão do SDK ou
 * da conta ainda não suportar o parâmetro, desligamos e seguimos sem ele em vez
 * de deixar a funcionalidade em baixo.
 */
let fallbacksSupported = true;

/**
 * Traduz um erro da API da Anthropic numa mensagem para o subscritor. Falta de
 * saldo e chave inválida são problemas da plataforma, não do utilizador: a
 * mensagem não expõe o detalhe, que fica gravado em `ai_messages.error`.
 */
/**
 * Mensagens devolvidas pela própria função (não pelo modelo), na língua da
 * interface (`language` no corpo do pedido).
 */
const MSG = {
  rateLimit: {
    "pt-MZ": "O assistente está com muitos pedidos neste momento. Tente dentro de alguns segundos.",
    "en-GB": "The assistant is handling a lot of requests right now. Please try again in a few seconds.",
    "fr-FR": "L'assistant reçoit beaucoup de demandes en ce moment. Veuillez réessayer dans quelques secondes.",
  },
  unavailable: {
    "pt-MZ": "O assistente está temporariamente indisponível. Se o problema persistir, contacte o apoio ao cliente.",
    "en-GB": "The assistant is temporarily unavailable. If the problem persists, please contact customer support.",
    "fr-FR": "L'assistant est temporairement indisponible. Si le problème persiste, veuillez contacter le service client.",
  },
  overloaded: {
    "pt-MZ": "O serviço de IA está sobrecarregado. Tente dentro de alguns minutos.",
    "en-GB": "The AI service is overloaded. Please try again in a few minutes.",
    "fr-FR": "Le service d'IA est surchargé. Veuillez réessayer dans quelques minutes.",
  },
  generic: {
    "pt-MZ": "Ocorreu um erro ao consultar o assistente. Tente novamente.",
    "en-GB": "An error occurred while contacting the assistant. Please try again.",
    "fr-FR": "Une erreur s'est produite lors de la consultation de l'assistant. Veuillez réessayer.",
  },
  missingApiKey: {
    "pt-MZ": "O assistente não está configurado neste ambiente.",
    "en-GB": "The assistant is not configured in this environment.",
    "fr-FR": "L'assistant n'est pas configuré dans cet environnement.",
  },
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
  missingFields: {
    "pt-MZ": "Faltam campos obrigatórios (company_id, message).",
    "en-GB": "Required fields are missing (company_id, message).",
    "fr-FR": "Des champs obligatoires sont manquants (company_id, message).",
  },
  tooLong: {
    "pt-MZ": "A pergunta é demasiado longa. Reformule em menos de 4000 caracteres.",
    "en-GB": "Your question is too long. Please rephrase it in fewer than 4,000 characters.",
    "fr-FR": "Votre question est trop longue. Veuillez la reformuler en moins de 4 000 caractères.",
  },
  invalidSession: {
    "pt-MZ": "Sessão inválida ou expirada.",
    "en-GB": "Your session is invalid or has expired.",
    "fr-FR": "Session invalide ou expirée.",
  },
  planDisabled: {
    "pt-MZ": "O assistente não está disponível no seu plano.",
    "en-GB": "The assistant is not available on your plan.",
    "fr-FR": "L'assistant n'est pas disponible dans votre formule.",
  },
  planLimit: {
    "pt-MZ": "Atingiu o limite de utilização do assistente no seu plano.",
    "en-GB": "You have reached the assistant usage limit for your plan.",
    "fr-FR": "Vous avez atteint la limite d'utilisation de l'assistant pour votre formule.",
  },
  forbidden: {
    "pt-MZ": "Sem acesso aos dados desta empresa.",
    "en-GB": "You do not have access to this company's data.",
    "fr-FR": "Vous n'avez pas accès aux données de cette entreprise.",
  },
  conversationFailed: {
    "pt-MZ": "Não foi possível iniciar a conversa.",
    "en-GB": "Could not start the conversation.",
    "fr-FR": "Impossible de démarrer la conversation.",
  },
  refusal: {
    "pt-MZ": "Não consigo responder a este pedido. Reformule a pergunta ou contacte o apoio ao cliente.",
    "en-GB": "I can't answer this request. Please rephrase your question or contact customer support.",
    "fr-FR": "Je ne peux pas répondre à cette demande. Veuillez reformuler votre question ou contacter le service client.",
  },
  maxTurns: {
    "pt-MZ": "A consulta ficou demasiado longa. Tente uma pergunta mais específica, por exemplo indicando um período concreto.",
    "en-GB": "The query became too long. Try a more specific question, for example by giving a specific period.",
    "fr-FR": "La requête est devenue trop longue. Essayez une question plus précise, par exemple en indiquant une période donnée.",
  },
} satisfies Record<string, Localized>;

function mensagemDeErro(err: unknown, lang: EmailLanguage = "pt-MZ"): string {
  if (err instanceof Anthropic.RateLimitError) {
    return pick(MSG.rateLimit, lang);
  }

  // A falta de saldo chega como 400 invalid_request_error, sem classe própria
  // no SDK; só o texto a distingue de um pedido mal formado.
  const semSaldo = err instanceof Anthropic.BadRequestError &&
    /credit balance/i.test(err.message);

  if (
    semSaldo ||
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return pick(MSG.unavailable, lang);
  }

  if (err instanceof Anthropic.InternalServerError) {
    return pick(MSG.overloaded, lang);
  }

  return pick(MSG.generic, lang);
}

interface RequestBody {
  company_id?: string;
  conversation_id?: string | null;
  message?: string;
  surface?: "chat" | "search";
  /** Língua da interface: 'pt-MZ' | 'en-GB' | 'fr-FR'. Sem ela, usa profiles.language. */
  language?: string;
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function jsonError(message: string, code: string, status: number): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Converte os resultados das ferramentas em anexos que a aplicação sabe
 * desenhar como tabela e exportar para Excel ou PDF. Procura-se o primeiro
 * array de objectos dentro do resultado: é essa a lista que interessa ao
 * utilizador (produtos, clientes, facturas, séries).
 */
function buildAttachments(
  results: { nome: string; payload: unknown }[],
): unknown[] {
  const anexos: unknown[] = [];

  for (const { nome, payload } of results) {
    if (!payload || typeof payload !== "object") continue;

    for (const [chave, valor] of Object.entries(payload as Record<string, unknown>)) {
      if (!Array.isArray(valor) || valor.length === 0) continue;
      if (typeof valor[0] !== "object" || valor[0] === null) continue;

      anexos.push({
        tipo: "tabela",
        origem: nome,
        titulo: chave.replace(/_/g, " "),
        colunas: Object.keys(valor[0] as Record<string, unknown>),
        linhas: valor.slice(0, 200),
      });
    }
  }

  return anexos;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // O corpo é lido primeiro para as mensagens de erro já saírem na língua da
  // interface.
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(MSG.badRequest["pt-MZ"], "BAD_REQUEST", 400);
  }

  const { company_id, conversation_id, message, surface = "chat" } = body;
  const languageFromBody = typeof body.language === "string" && body.language.trim() !== "";
  let lang: EmailLanguage = normalizeLanguage(body.language);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonError(pick(MSG.missingApiKey, lang), "MISSING_API_KEY", 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonError(pick(MSG.unauthenticated, lang), "UNAUTHENTICATED", 401);
  }

  if (!company_id || !message?.trim()) {
    return jsonError(pick(MSG.missingFields, lang), "BAD_REQUEST", 400);
  }

  if (message.length > 4000) {
    return jsonError(pick(MSG.tooLong, lang), "MESSAGE_TOO_LONG", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // Cliente com o JWT do utilizador: tudo o que o assistente lê passa pelo RLS.
  const userClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // Cliente privilegiado: apenas para verificar quota e registar consumo.
  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return jsonError(pick(MSG.invalidSession, lang), "UNAUTHENTICATED", 401);
  }

  // Sem `language` no pedido, usa a língua guardada no perfil.
  if (!languageFromBody) lang = await getUserLanguage(adminClient, user.id);

  // Quota e entitlement, antes de qualquer token gasto.
  const { error: quotaError } = await adminClient.rpc("ai_assert_quota", {
    p_company_id: company_id,
  });
  if (quotaError) {
    const limite = quotaError.message?.includes("limite");
    // Em pt-MZ mantém-se a mensagem do SQL (mais detalhada); nas outras
    // línguas usa-se uma mensagem fixa traduzida.
    const mensagem = lang === "pt-MZ"
      ? quotaError.message ?? MSG.planDisabled["pt-MZ"]
      : pick(limite ? MSG.planLimit : MSG.planDisabled, lang);
    return jsonError(
      mensagem,
      limite ? "SUBSCRIPTION_LIMIT_REACHED" : "SUBSCRIPTION_FEATURE_DISABLED",
      402,
    );
  }

  // Também funciona como verificação de acesso: a função rejeita empresas que
  // não sejam do utilizador.
  const { data: snapshot, error: snapshotError } = await userClient.rpc(
    "ai_company_snapshot",
    { p_company_id: company_id },
  );
  if (snapshotError) {
    return jsonError(pick(MSG.forbidden, lang), "FORBIDDEN", 403);
  }

  // --- Conversa -------------------------------------------------------------

  let conversationId = conversation_id ?? null;

  if (conversationId) {
    const { data: existing } = await userClient
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("company_id", company_id)
      .maybeSingle();
    if (!existing) conversationId = null;
  }

  if (!conversationId) {
    const titulo = message.trim().slice(0, 80);
    const { data: created, error: createError } = await userClient
      .from("ai_conversations")
      .insert({ company_id, user_id: user.id, title: titulo })
      .select("id")
      .single();

    if (createError || !created) {
      return jsonError(pick(MSG.conversationFailed, lang), "DB_ERROR", 500);
    }
    conversationId = created.id;
  }

  // As mensagens mais RECENTES são as que importam, por isso ordena-se de forma
  // decrescente, corta-se, e inverte-se. Ordenar ascendente com limite traria as
  // 20 primeiras mensagens e perderia todo o contexto recente numa conversa
  // longa.
  const { data: historicoRecente } = await userClient
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const messages: Anthropic.MessageParam[] = [];

  // O histórico é reenviado apenas como texto. Os blocos originais ficam
  // gravados para auditoria, mas não podem ser replicados aqui: um bloco
  // tool_use sem o tool_result correspondente na mensagem seguinte faz a API
  // rejeitar o pedido inteiro, e os resultados das ferramentas são memória de
  // trabalho de um turno, não contexto de conversa.
  for (const linha of (historicoRecente ?? []).slice().reverse()) {
    if (!linha.content) continue;
    messages.push({
      role: linha.role as "user" | "assistant",
      content: linha.content,
    });
  }

  // A primeira mensagem tem de ser do utilizador; se o corte do histórico
  // começar numa resposta do assistente, descarta-se essa resposta órfã.
  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift();
  }

  messages.push({ role: "user", content: message.trim() });

  await userClient.from("ai_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message.trim(),
  });

  // --- Conversa com o modelo ------------------------------------------------

  const anthropic = new Anthropic({ apiKey });
  const contexto = buildContextBlock(
    (snapshot ?? {}) as Record<string, never>,
    user.user_metadata?.full_name ?? user.email ?? "Utilizador",
    lang,
  );

  const stream = new ReadableStream({
    async start(controller) {
      const iniciado = Date.now();
      const toolRecords: ToolCallRecord[] = [];
      const toolPayloads: { nome: string; payload: unknown }[] = [];
      let finalBlocks: Anthropic.ContentBlock[] = [];
      let textoFinal = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let erro: string | null = null;

      const enviar = (evento: string, dados: unknown) => {
        try {
          controller.enqueue(sseEvent(evento, dados));
        } catch {
          // O cliente desligou-se; deixamos o ciclo terminar e gravar o que há.
        }
      };

      // Enquanto o modelo pensa ou as ferramentas correm, não sai nada no
      // stream. Um comentário SSE periódico mantém a ligação viva em proxies e
      // redes móveis e permite ao cliente distinguir "a pensar" de "ligação
      // morta" (o cliente desiste ao fim de algum tempo sem receber bytes).
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(": ping\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, KEEPALIVE_MS);

      enviar("meta", { conversation_id: conversationId });

      // Não é async de propósito: `.stream()` devolve o objecto de stream de
      // forma síncrona. Os erros do pedido só aparecem ao aguardar
      // `finalMessage()`, que é onde estão os try/catch.
      const pedirAoModelo = (usarFallbacks: boolean) => {
        const params: Record<string, unknown> = {
          model: MODEL,
          max_tokens: 8000,
          // O prefixo estável entra em cache; o contexto da empresa vem depois
          // do ponto de corte para não o invalidar.
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: contexto },
          ],
          tools: TOOL_DEFINITIONS,
          thinking: { type: "adaptive" },
          // A pesquisa quer latência; o chat quer profundidade de raciocínio
          // sobre os dados devolvidos. Nenhum dos dois justifica effort alto:
          // o trabalho difícil está nas consultas SQL, não no modelo.
          output_config: { effort: surface === "search" ? "low" : "medium" },
          messages,
        };

        if (usarFallbacks) {
          params.betas = ["server-side-fallback-2026-07-01"];
          params.fallbacks = "default";
          return anthropic.beta.messages.stream(params as never);
        }
        return anthropic.messages.stream(params as never);
      };

      try {
        for (let turno = 0; turno < MAX_TURNS; turno++) {
          let resposta: Anthropic.Message;

          try {
            const s = pedirAoModelo(fallbacksSupported);
            s.on("text", (delta: string) => enviar("delta", { text: delta }));
            resposta = (await s.finalMessage()) as Anthropic.Message;
          } catch (err) {
            const badRequest = err instanceof Anthropic.BadRequestError;
            if (badRequest && fallbacksSupported) {
              // Pode ser a conta ou o SDK a recusar o parâmetro, ou outro 400
              // qualquer (saldo esgotado, por exemplo). Repete-se sem ele e só
              // se desliga de vez se a repetição passar: de outro modo um 400
              // alheio desligaria os fallbacks até a instância reiniciar.
              console.warn("pedido com fallbacks recusado, a repetir sem:", err.message);
              const s = pedirAoModelo(false);
              s.on("text", (delta: string) => enviar("delta", { text: delta }));
              resposta = (await s.finalMessage()) as Anthropic.Message;
              fallbacksSupported = false;
            } else {
              throw err;
            }
          }

          inputTokens += resposta.usage.input_tokens ?? 0;
          outputTokens += resposta.usage.output_tokens ?? 0;
          cacheReadTokens += resposta.usage.cache_read_input_tokens ?? 0;
          cacheWriteTokens += resposta.usage.cache_creation_input_tokens ?? 0;

          messages.push({ role: "assistant", content: resposta.content });
          finalBlocks = resposta.content;

          if (resposta.stop_reason === "refusal") {
            erro = "REFUSAL";
            textoFinal = pick(MSG.refusal, lang);
            enviar("delta", { text: textoFinal });
            break;
          }

          if (resposta.stop_reason !== "tool_use") {
            textoFinal = resposta.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("");
            break;
          }

          const chamadas = resposta.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          for (const c of chamadas) {
            enviar("tool", { nome: c.name });
          }

          // As ferramentas são independentes entre si: executá-las em paralelo
          // poupa uma ida e volta à base de dados por cada uma.
          const resultados = await Promise.all(
            chamadas.map((c) =>
              executeTool(
                userClient,
                company_id,
                c.name,
                (c.input ?? {}) as Record<string, unknown>,
              ).then((r) => ({ id: c.id, nome: c.name, ...r })),
            ),
          );

          for (const r of resultados) {
            toolRecords.push(r.record);
            try {
              toolPayloads.push({ nome: r.nome, payload: JSON.parse(r.content) });
            } catch {
              // Resultado não-JSON: não gera anexo, mas segue para o modelo.
            }
          }

          // Todos os tool_result têm de vir na MESMA mensagem de utilizador,
          // senão a API deixa de emitir chamadas em paralelo.
          messages.push({
            role: "user",
            content: resultados.map((r) => ({
              type: "tool_result" as const,
              tool_use_id: r.id,
              content: r.content,
              is_error: Boolean(r.record.erro),
            })),
          });

          if (turno === MAX_TURNS - 1) {
            erro = "MAX_TURNS";
            textoFinal = pick(MSG.maxTurns, lang);
            enviar("delta", { text: textoFinal });
          }
        }
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        console.error("ai-assistant:", mensagem);
        erro = mensagem;

        const amigavel = mensagemDeErro(err, lang);

        enviar("error", { message: amigavel, code: "AI_ERROR" });
        textoFinal = textoFinal || amigavel;
      }

      const anexos = buildAttachments(toolPayloads);
      const duracao = Date.now() - iniciado;

      // A gravação acontece mesmo em caso de erro: o utilizador tem de ver o
      // histórico tal como o viveu, incluindo as respostas que falharam.
      try {
        await userClient.from("ai_messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: textoFinal,
          blocks: finalBlocks,
          tool_calls: toolRecords,
          attachments: anexos,
          model: MODEL,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          latency_ms: duracao,
          error: erro,
        });

        await userClient
          .from("ai_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId);

        // Só o consumo efectivo conta para a quota. Um pedido que rebentou
        // antes de chegar ao modelo não é cobrado ao subscritor.
        if (inputTokens > 0 || outputTokens > 0) {
          const custo =
            (inputTokens / 1_000_000) * PRICE_INPUT +
            (outputTokens / 1_000_000) * PRICE_OUTPUT +
            (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ +
            (cacheWriteTokens / 1_000_000) * PRICE_CACHE_WRITE;

          await adminClient.from("ai_usage_events").insert({
            company_id,
            user_id: user.id,
            conversation_id: conversationId,
            surface,
            model: MODEL,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_tokens: cacheReadTokens,
            cost_usd: Number(custo.toFixed(6)),
          });
        }
      } catch (err) {
        console.error("ai-assistant: falha a gravar", err);
      }

      clearInterval(keepAlive);
      enviar("done", {
        conversation_id: conversationId,
        anexos,
        ferramentas: toolRecords.map((t) => t.nome),
        duracao_ms: duracao,
      });

      try {
        controller.close();
      } catch {
        // O cliente já se tinha desligado.
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
