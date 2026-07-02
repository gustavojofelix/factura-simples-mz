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

Deno.serve(async (req: Request) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    }

    const { message, history, context } = await req.json() as RequestBody;

    if (!message) {
      throw new Error("Missing required field: message");
    }

    // Format chat history for Gemini contents array
    // Gemini roles: 'user' and 'model' (instead of assistant)
    const contents = [];
    
    // Add history items
    if (history && history.length > 0) {
      for (const item of history) {
        contents.push({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }]
        });
      }
    }

    // Add current user message
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // Construct system instructions with context details
    const pageNames: Record<string, string> = {
      'painel': 'Painel/Dashboard Geral',
      'facturas': 'Módulo de Faturação/Facturas',
      'clientes': 'Módulo de Gestão de Clientes',
      'produtos': 'Módulo de Produtos e Serviços',
      'impostos': 'Módulo de Impostos (Declarações ISPC/M30)',
      'relatorios': 'Módulo de Relatórios e Estatísticas',
      'configuracoes': 'Configurações do Sistema e Subscrição',
      'perfil': 'Perfil do Utilizador',
      'auditoria': 'Logs de Auditoria de Ações'
    };

    const friendlyPage = pageNames[context.page] || context.page;

    const systemInstruction = `Você é o "Assistente ISPC Fácil", um assistente de inteligência artificial de elite integrado no sistema Factura Simples MZ (ISPC Fácil) em Moçambique.
Seu objetivo é ajudar empresários, gerentes e vendedores moçambicanos a gerenciar seus negócios, emitir faturas e cumprir obrigações fiscais locais de forma simples.

DADOS DE CONTEXTO ATUAL DO UTILIZADOR:
- Empresa ativa no sistema: "${context.companyName || 'Nenhuma selecionada'}"
- Nível de permissão/Role do utilizador: "${context.userRole || 'Utilizador'}"
- Página/Secção que o utilizador está a visualizar neste momento: "${friendlyPage}"

DIRETRIZES IMPORTANTES PARA AS RESPOSTAS:
1. **Idioma**: Responda sempre em Português de Moçambique, de forma profissional, educada, clara e acolhedora.
2. **Contextualização Moçambicana**:
   - Moeda oficial: Metical (MT / MZN).
   - Impostos locais: ISPC (Imposto Simplificado sobre Pequenos Contribuintes - com brackets progressivos de 3%, 4%, 5% e 20% sobre o excedente), IVA (Imposto sobre o Valor Acrescentado - taxa padrão de 16%, com várias isenções para bens essenciais como arroz, farinha, pão), retenções na fonte.
   - Órgão fiscal: Autoridade Tributária de Moçambique (AT).
3. **Escopo**:
   - Ajude o utilizador a navegar pelo sistema (ex: indicar como ir a "Configurações" ou "Clientes" se perguntarem como fazer).
   - Tire dúvidas sobre como calcular impostos, quando pagar ou os prazos de submissão (ISPC declara-se trimestralmente até ao fim do mês seguinte ao trimestre).
   - Nunca invente leis. Se não tiver a certeza, aconselhe o utilizador a consultar a Autoridade Tributária ou um contabilista certificado moçambicano.
4. **Formatação**: Suas respostas devem ser curtas, legíveis, organizadas em listas e em Markdown (use negrito para realçar pontos importantes).

Retorne a resposta estritamente no formato JSON estruturado especificado no responseSchema.`;

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply: {
              type: "STRING",
              description: "A resposta do assistente formatada em markdown amigável."
            },
            suggestions: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "3 sugestões de perguntas curtas e relevantes para o utilizador continuar a conversa com base no contexto."
            }
          },
          required: ["reply", "suggestions"]
        }
      }
    };

    // Call Google Gemini API
    // We use gemini-1.5-flash as it is fast, highly capable, and cost-effective
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

    if (!responseText) {
      throw new Error("No text response received from Gemini model.");
    }

    // Parse the JSON structured response from Gemini
    const parsedResponse = JSON.parse(responseText);

    return new Response(
      JSON.stringify({
        reply: parsedResponse.reply,
        suggestions: parsedResponse.suggestions
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error("Error in chat-assistant Edge Function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
