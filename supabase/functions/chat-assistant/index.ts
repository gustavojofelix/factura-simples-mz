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

interface AIActionPayload {
  type: "CREATE_PRODUCTS" | "CREATE_CLIENTS" | "NAVIGATE" | "FILTER_DATA" | "GENERATE_REPORT";
  label: string;
  requiresConfirmation: boolean;
  payload: any;
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

// Preferred model priority list
const PREFERRED_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-pro",
];

async function discoverModel(apiKey: string): Promise<string> {
  const listResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { method: "GET", headers: { "Content-Type": "application/json" } }
  );

  if (!listResponse.ok) return PREFERRED_MODELS[0];

  const listData = await listResponse.json();
  const availableModels: string[] = (listData.models || [])
    .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: any) => (m.name as string).replace("models/", ""));

  for (const preferred of PREFERRED_MODELS) {
    if (availableModels.includes(preferred)) return preferred;
  }
  if (availableModels.length > 0) return availableModels[0];
  throw new Error("No Gemini models available.");
}

const MOZAMBICAN_MARKET_KNOWLEDGE = `
CATÁLOGO DO MERCADO MOÇAMBICANO POR SECTOR (use para sugerir produtos/serviços realistas):

ELECTRÓNICA & INFORMÁTICA:
Produtos: Cabo HDMI (350-800 MT), Carregador universal (250-600 MT), Pen USB 32GB (200-450 MT),
Rato sem fio (300-700 MT), Teclado USB (400-900 MT), Fone de ouvido (350-1200 MT),
Extensão eléctrica 5m (300-700 MT), Tomada múltipla (250-550 MT), Cabo USB-C (200-500 MT),
Webcam HD (1500-3500 MT), Impressora (8000-25000 MT), Toner/Cartucho (1200-4500 MT),
Smartphone básico (3500-8000 MT), Tablet (4500-15000 MT), Bateria externa (800-2500 MT),
Adaptador de corrente (300-800 MT), Cabo VGA (250-600 MT), Hub USB (500-1500 MT),
Lâmpada LED (150-400 MT), Câmara de segurança (2500-8000 MT)
Serviços: Reparação de computador (500-2000 MT), Instalação de software (300-800 MT),
Formatação e reinstalação (600-1500 MT), Recuperação de dados (1500-5000 MT),
Suporte técnico mensal (2000-6000 MT), Instalação de câmeras CCTV (3000-12000 MT)

CONSTRUÇÃO CIVIL:
Materiais: Cimento Portland 50kg (500-700 MT), Vergalhão 12mm/barra (450-650 MT),
Tijolo cerâmico (8-15 MT/un), Areia lavada m³ (1500-3000 MT), Brita m³ (2000-4000 MT),
Tinta interior 20L (2500-5000 MT), Tinta exterior 20L (3000-6000 MT),
Telha cerâmica (45-90 MT/un), Porta de alumínio (8000-20000 MT), Janela alumínio (5000-15000 MT),
Tubo PVC 4m (250-600 MT), Cano de água 25mm (150-400 MT), Caixa de luz (80-200 MT),
Fio eléctrico rolo (2500-6000 MT), Disjuntor (350-800 MT)
Serviços: Mão de obra por m² (500-1500 MT), Pintura por m² (150-400 MT),
Instalação eléctrica (ponto de luz: 800-1500 MT), Canalizações (metro linear: 300-800 MT)

ALIMENTAÇÃO & BEBIDAS:
Produtos: Arroz Carolina 5kg (650-900 MT), Feijão nhemba 1kg (120-200 MT),
Açúcar refinado 2kg (150-280 MT), Farinha de milho 5kg (250-450 MT),
Óleo de soja 1L (200-350 MT), Sal iodado 1kg (50-100 MT),
Frango inteiro (por kg: 250-400 MT), Refrigerante 2L (150-250 MT),
Água mineral 1.5L (50-100 MT), Cerveja 650ml (100-180 MT),
Leite UHT 1L (150-250 MT), Manteiga 250g (200-350 MT)

VESTUÁRIO & TÊXTEIS:
Serviços: Costura de camisa (300-800 MT), Costura de vestido (500-1500 MT),
Conserto de roupa (150-400 MT), Bordado (200-600 MT)

SAÚDE & FARMÁCIA:
Serviços: Consulta médica geral (500-2000 MT), Consulta de especialidade (1000-4000 MT),
Análise clínica básica (300-800 MT), Curativo (150-400 MT)

TRANSPORTES & LOGÍSTICA:
Serviços: Frete por km (30-80 MT), Aluguer de chapa (diária: 2000-6000 MT),
Entrega expressa urbana (200-600 MT), Mudanças (3000-15000 MT)

SERVIÇOS DE TI & DIGITAIS:
Serviços: Criação de website (15000-80000 MT), Manutenção mensal de site (2000-6000 MT),
Gestão de redes sociais (5000-15000 MT/mês), Design gráfico (1500-5000 MT),
Desenvolvimento de app (50000-200000 MT), SEO (3000-8000 MT/mês),
Email corporativo (500-1500 MT/utilizador/mês), Hospedagem web anual (3000-12000 MT)

EDUCAÇÃO & FORMAÇÃO:
Serviços: Aulas particulares/hora (300-800 MT), Formação profissional (1500-8000 MT/módulo),
Tradução de documentos (por página: 200-600 MT), Propina mensal (2000-15000 MT)

HOTELARIA & RESTAURAÇÃO:
Serviços: Quarto single (diária: 2000-8000 MT), Refeição executiva (300-800 MT),
Coffee break (200-600 MT/pessoa), Aluguer de sala (3000-12000 MT/dia),
Catering (500-1500 MT/pessoa)

BELEZA & CUIDADOS PESSOAIS:
Serviços: Corte de cabelo (200-500 MT), Manicure (300-700 MT), Pedicure (400-800 MT),
Tratamento de cabelo (800-3000 MT), Maquiagem (600-2000 MT)
`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set.");
    GEMINI_API_KEY = GEMINI_API_KEY.replace(/^["']|["']$/g, "");

    const { message, history, context } = await req.json() as RequestBody;
    if (!message) throw new Error("Missing required field: message");

    const modelId = await discoverModel(GEMINI_API_KEY);

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

    const pageNames: Record<string, string> = {
      'painel': 'Painel/Dashboard Geral',
      'facturas': 'Módulo de Faturação/Facturas',
      'clientes': 'Módulo de Gestão de Clientes',
      'produtos': 'Módulo de Produtos e Serviços',
      'impostos': 'Módulo de Impostos (Declarações ISPC/M30)',
      'relatorios': 'Módulo de Relatórios e Estatísticas',
      'configuracoes': 'Configurações do Sistema e Subscrição',
      'perfil': 'Perfil do Utilizador',
      'auditoria': 'Logs de Auditoria de Ações',
      'assistente': 'Assistente de IA (full-screen)',
      'designer-de-facturas': 'Designer de Modelos de Factura',
      'insights-ia': 'Hub de Inteligência e Análise Financeira'
    };
    const friendlyPage = pageNames[context.page] || context.page;

    const systemText = `Você é o "Assistente ISPC Fácil", uma IA especializada em faturação e gestão empresarial para Moçambique.
Você NÃO é apenas um chatbot explicativo — você É a plataforma. Você EXECUTA acções reais quando o utilizador pede.

CONTEXTO ATUAL:
- Empresa: "${context.companyName || 'Nenhuma selecionada'}"
- Cargo do utilizador: "${context.userRole || 'Utilizador'}"
- Secção aberta: "${friendlyPage}"

${MOZAMBICAN_MARKET_KNOWLEDGE}

REGRAS DE RESPOSTA:
1. Responda SEMPRE em Português de Moçambique, de forma clara e acolhedora.
2. Moeda = Metical (MT/MZN). Imposto principal = ISPC (3%/4%/5%/20% progressivo), IVA 16%.
3. Prazo ISPC: trimestral, até ao fim do mês seguinte ao trimestre.
4. Nunca invente leis — recomende a AT ou um contabilista se não tiver certeza.
5. Responda em Markdown com listas e negrito no campo "reply".
6. Use preços realistas do mercado moçambicano nos produtos sugeridos.

REGRAS DE ACÇÕES (CRÍTICO):
Quando o utilizador pedir para CRIAR produtos, serviços ou clientes, você DEVE incluir o campo "actions" na resposta.

Para CREATE_PRODUCTS: gere entre 8-15 produtos/serviços típicos do sector mencionado, com preços realistas em MT.
Para CREATE_CLIENTS: gere os clientes pedidos com nomes, emails e telefones fictícios realistas para Moçambique.

Exemplos de triggers para acções:
- "cria produtos de electrónica" → CREATE_PRODUCTS com produtos do sector
- "adiciona serviços de construção" → CREATE_PRODUCTS com serviços
- "cria 3 clientes de teste" → CREATE_CLIENTS
- "vai para facturas" / "abre relatórios" → NAVIGATE

FORMATO DE RESPOSTA OBRIGATÓRIO:
Retorne sempre um JSON com:
- "reply": string markdown (resposta para o utilizador)
- "suggestions": array de 3 strings (próximos passos sugeridos)  
- "actions": array de acções (ou array vazio [] se não houver acções)

Para CREATE_PRODUCTS, o payload deve ter:
{
  "products": [
    {"name": "...", "description": "...", "price": 000, "type": "produto" ou "servico", "unit": "un/kg/h/m/etc"}
  ]
}

Para CREATE_CLIENTS, o payload deve ter:
{
  "clients": [
    {"name": "...", "email": "...", "phone": "...", "address": "...", "industry": "..."}
  ]
}

Para NAVIGATE, o payload deve ter:
{
  "route": "/facturas" (ou outra rota válida: /clientes, /produtos, /impostos, /relatorios, /configuracoes, /painel, /assistente, /insights-ia, /designer-de-facturas)
}`;

    const requestBody = {
      contents,
      systemInstruction: { parts: [{ text: systemText }] },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply: { type: "STRING" },
            suggestions: { type: "ARRAY", items: { type: "STRING" } },
            actions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  type: {
                    type: "STRING",
                    enum: ["CREATE_PRODUCTS", "CREATE_CLIENTS", "NAVIGATE", "FILTER_DATA", "GENERATE_REPORT"]
                  },
                  label: { type: "STRING" },
                  requiresConfirmation: { type: "BOOLEAN" },
                  payload: { type: "OBJECT" }
                },
                required: ["type", "label", "requiresConfirmation", "payload"]
              }
            }
          },
          required: ["reply", "suggestions", "actions"]
        }
      }
    };

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
      throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error("No text response from Gemini.");

    let parsedResponse: { reply: string; suggestions: string[]; actions: AIActionPayload[] };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      parsedResponse = {
        reply: responseText,
        suggestions: ["Como calcular o ISPC?", "Como emitir uma factura?", "Que produtos posso criar?"],
        actions: []
      };
    }

    // Ensure actions is always an array
    if (!Array.isArray(parsedResponse.actions)) {
      parsedResponse.actions = [];
    }

    return new Response(
      JSON.stringify({
        reply: parsedResponse.reply,
        suggestions: parsedResponse.suggestions || [],
        actions: parsedResponse.actions
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in chat-assistant:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
