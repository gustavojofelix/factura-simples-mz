import "@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { SYSTEM_PROMPT, buildContextBlock } from "./prompt.ts";
import { TOOL_DEFINITIONS, executeTool, type ToolCallRecord } from "./tools.ts";

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

// Preços do Claude Opus 5, por milhão de tokens. Usados apenas para registar
// custo estimado por empresa no backoffice.
const PRICE_INPUT = 5.0;
const PRICE_OUTPUT = 25.0;
const PRICE_CACHE_READ = 0.5;

/**
 * Fallback do lado do servidor: se o modelo recusar por política, a API repete
 * o mesmo pedido noutro modelo dentro da mesma chamada. Se a versão do SDK ou
 * da conta ainda não suportar o parâmetro, desligamos e seguimos sem ele em vez
 * de deixar a funcionalidade em baixo.
 */
let fallbacksSupported = true;

interface RequestBody {
  company_id?: string;
  conversation_id?: string | null;
  message?: string;
  surface?: "chat" | "search";
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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonError(
      "O assistente não está configurado neste ambiente.",
      "MISSING_API_KEY",
      503,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonError("Sessão não autenticada.", "UNAUTHENTICATED", 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError("Pedido inválido.", "BAD_REQUEST", 400);
  }

  const { company_id, conversation_id, message, surface = "chat" } = body;

  if (!company_id || !message?.trim()) {
    return jsonError(
      "Faltam campos obrigatórios (company_id, message).",
      "BAD_REQUEST",
      400,
    );
  }

  if (message.length > 4000) {
    return jsonError(
      "A pergunta é demasiado longa. Reformule em menos de 4000 caracteres.",
      "MESSAGE_TOO_LONG",
      400,
    );
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
    return jsonError("Sessão inválida ou expirada.", "UNAUTHENTICATED", 401);
  }

  // Quota e entitlement, antes de qualquer token gasto.
  const { error: quotaError } = await adminClient.rpc("ai_assert_quota", {
    p_company_id: company_id,
  });
  if (quotaError) {
    const limite = quotaError.message?.includes("limite");
    return jsonError(
      quotaError.message ?? "O assistente não está disponível no seu plano.",
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
    return jsonError("Sem acesso aos dados desta empresa.", "FORBIDDEN", 403);
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
      return jsonError("Não foi possível iniciar a conversa.", "DB_ERROR", 500);
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
      let erro: string | null = null;

      const enviar = (evento: string, dados: unknown) => {
        try {
          controller.enqueue(sseEvent(evento, dados));
        } catch {
          // O cliente desligou-se; deixamos o ciclo terminar e gravar o que há.
        }
      };

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
              // A conta ou a versão do SDK não aceita o parâmetro; segue sem ele.
              console.warn("fallbacks indisponíveis, a repetir sem:", err.message);
              fallbacksSupported = false;
              const s = pedirAoModelo(false);
              s.on("text", (delta: string) => enviar("delta", { text: delta }));
              resposta = (await s.finalMessage()) as Anthropic.Message;
            } else {
              throw err;
            }
          }

          inputTokens += resposta.usage.input_tokens ?? 0;
          outputTokens += resposta.usage.output_tokens ?? 0;
          cacheReadTokens += resposta.usage.cache_read_input_tokens ?? 0;

          messages.push({ role: "assistant", content: resposta.content });
          finalBlocks = resposta.content;

          if (resposta.stop_reason === "refusal") {
            erro = "REFUSAL";
            textoFinal =
              "Não consigo responder a este pedido. Reformule a pergunta ou " +
              "contacte o apoio ao cliente.";
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
            textoFinal =
              "A consulta ficou demasiado longa. Tente uma pergunta mais " +
              "específica, por exemplo indicando um período concreto.";
            enviar("delta", { text: textoFinal });
          }
        }
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        console.error("ai-assistant:", mensagem);
        erro = mensagem;

        const amigavel = err instanceof Anthropic.RateLimitError
          ? "O assistente está com muitos pedidos neste momento. Tente dentro de alguns segundos."
          : "Ocorreu um erro ao consultar o assistente. Tente novamente.";

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
            (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ;

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

      enviar("done", {
        conversation_id: conversationId,
        anexos,
        ferramentas: toolRecords.map((t) => t.nome),
        duracao_ms: duracao,
      });

      controller.close();
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
