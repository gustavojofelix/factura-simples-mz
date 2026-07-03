import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatHistoryItem {
  role: "user" | "assistant" | "model";
  content: string;
}

interface RequestBody {
  message: string;
  history: ChatHistoryItem[];
  context: {
    page: string;
    companyId: string | null;
    companyName: string | null;
    userRole: string | null;
  };
}

// Preferred model priority list — first available one wins
const PREFERRED_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-pro",
];

async function discoverModel(apiKey: string): Promise<string> {
  console.log("[INFO] Discovering available Gemini models for this API key...");
  const listResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { method: "GET", headers: { "Content-Type": "application/json" } }
  );

  if (!listResponse.ok) {
    const errText = await listResponse.text();
    console.error("[WARN] ListModels failed:", errText);
    // Fallback to first preferred model if list fails
    return PREFERRED_MODELS[0];
  }

  const listData = await listResponse.json();
  const availableModels: string[] = (listData.models || [])
    .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: any) => (m.name as string).replace("models/", ""));

  console.log("[INFO] Models available for generateContent:", availableModels.join(", "));

  // Pick the highest-priority preferred model that is available
  for (const preferred of PREFERRED_MODELS) {
    if (availableModels.includes(preferred)) {
      console.log(`[INFO] Selected model: ${preferred}`);
      return preferred;
    }
  }

  // Last resort: pick the first available model from the list
  if (availableModels.length > 0) {
    console.log(`[INFO] No preferred model available. Using first available: ${availableModels[0]}`);
    return availableModels[0];
  }

  throw new Error("No Gemini models available for generateContent with this API key.");
}

Deno.serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    }
    // Clean API Key in case it has literal quotes from CLI deployment
    GEMINI_API_KEY = GEMINI_API_KEY.replace(/^["']|["']$/g, "");

    console.log(`[DEBUG] GEMINI_API_KEY length: ${GEMINI_API_KEY.length}`);
    console.log(`[DEBUG] GEMINI_API_KEY prefix: ${GEMINI_API_KEY.substring(0, 6)}`);

    const { message, history, context } = await req.json() as RequestBody;
    if (!message) throw new Error("Missing required field: message");

    // Auto-discover the best available model for this API key
    const modelId = await discoverModel(GEMINI_API_KEY);

    // Format chat history for Gemini contents array
    const contents = [];
    if (history && history.length > 0) {
      for (const item of history) {
        contents.push({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }]
        });
      }
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    // Build contextual system instruction
    const pageNames: Record<string, string> = {
      'painel':        'Painel/Dashboard Geral',
      'facturas':      'Módulo de Faturação/Facturas',
      'clientes':      'Módulo de Gestão de Clientes',
      'produtos':      'Módulo de Produtos e Serviços',
      'impostos':      'Módulo de Impostos (Declarações ISPC/M30)',
      'relatorios':    'Módulo de Relatórios e Estatísticas',
      'configuracoes': 'Configurações do Sistema e Subscrição',
      'perfil':        'Perfil do Utilizador',
      'auditoria':     'Logs de Auditoria de Ações'
    };
    const friendlyPage = pageNames[context.page] || context.page;

    const systemText = `Você é o "Assistente ISPC Fácil", integrado no sistema Factura Simples MZ em Moçambique.
Ajude empresários moçambicanos a gerir o seu negócio, emitir facturas e cumprir obrigações fiscais locais.

CONTEXTO ATUAL:
- Empresa: "${context.companyName || 'Nenhuma selecionada'}"
- Cargo do utilizador: "${context.userRole || 'Utilizador'}"
- Secção aberta: "${friendlyPage}"

REGRAS:
1. Responda SEMPRE em Português de Moçambique, de forma clara e acolhedora.
2. Moeda = Metical (MT/MZN). Imposto principal = ISPC (3%/4%/5%/20% progressivo), IVA 16%.
3. Prazo ISPC: trimestral, até ao fim do mês seguinte ao trimestre.
4. Nunca invente leis — recomende a AT ou um contabilista se não tiver certeza.
5. Responda em Markdown com listas e negrito.
6. Devolva SEMPRE um JSON com os campos "reply" (string markdown) e "suggestions" (lista de 3 strings).`;

    const requestBody = {
      contents,
      systemInstruction: { parts: [{ text: systemText }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply:       { type: "STRING" },
            suggestions: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["reply", "suggestions"]
        }
      }
    };

    console.log(`[INFO] Sending request to model: ${modelId}`);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error Response:", errorText);
      throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error("No text response received from Gemini model.");

    // Parse the structured JSON from Gemini
    let parsedResponse: { reply: string; suggestions: string[] };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      // If model returned plain text instead of JSON, wrap it
      parsedResponse = {
        reply: responseText,
        suggestions: ["Como calcular o ISPC?", "Como emitir uma factura?", "Quais são os meus relatórios?"]
      };
    }

    return new Response(
      JSON.stringify({ reply: parsedResponse.reply, suggestions: parsedResponse.suggestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in chat-assistant Edge Function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
