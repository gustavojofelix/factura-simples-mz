import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PREFERRED_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

async function discoverModel(apiKey: string): Promise<string> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) return PREFERRED_MODELS[0];
    const data = await res.json();
    const available = (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => m.name.replace("models/", ""));
    for (const p of PREFERRED_MODELS) if (available.includes(p)) return p;
    return available[0] || PREFERRED_MODELS[0];
  } catch {
    return PREFERRED_MODELS[0];
  }
}

interface InsightRequest {
  companyId: string;
  companyName: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = (Deno.env.get("GEMINI_API_KEY") || "").replace(/^["']|["']$/g, "");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set.");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { companyId, companyName } = await req.json() as InsightRequest;
    if (!companyId) throw new Error("Missing companyId");

    // Gather financial data for the company
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch invoices
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount, status, issue_date, due_date, client_id")
      .eq("company_id", companyId)
      .gte("issue_date", startOfYear)
      .order("issue_date", { ascending: false });

    // Fetch clients count
    const { count: clientCount } = await supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);

    // Fetch products count
    const { count: productCount } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);

    // Compute summary metrics
    const allInvoices = invoices || [];
    const paidInvoices = allInvoices.filter(i => i.status === "pago");
    const pendingInvoices = allInvoices.filter(i => i.status === "pendente" || i.status === "enviado");
    const overdueInvoices = allInvoices.filter(i => {
      if (!i.due_date || i.status === "pago" || i.status === "anulado") return false;
      return new Date(i.due_date) < now;
    });

    const totalRevenue = paidInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);
    const pendingRevenue = pendingInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);
    const overdueRevenue = overdueInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);

    // Monthly breakdown for this year
    const monthlyRevenue: Record<string, number> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`;
      monthlyRevenue[key] = 0;
    }
    paidInvoices.forEach(i => {
      const month = i.issue_date?.substring(0, 7);
      if (month && monthlyRevenue[month] !== undefined) {
        monthlyRevenue[month] += i.total_amount || 0;
      }
    });

    // Client concentration
    const clientRevenue: Record<string, number> = {};
    paidInvoices.forEach(i => {
      if (i.client_id) {
        clientRevenue[i.client_id] = (clientRevenue[i.client_id] || 0) + (i.total_amount || 0);
      }
    });
    const topClientRevenue = Math.max(0, ...Object.values(clientRevenue));
    const concentrationPct = totalRevenue > 0 ? Math.round((topClientRevenue / totalRevenue) * 100) : 0;

    // Current quarter ISPC estimate
    const currentMonth = now.getMonth() + 1;
    const currentQuarter = Math.ceil(currentMonth / 3);
    const quarterStart = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
    const quarterInvoices = paidInvoices.filter(i => new Date(i.issue_date) >= quarterStart);
    const quarterRevenue = quarterInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);

    // Progressive ISPC calculation
    let ispcEstimate = 0;
    if (quarterRevenue <= 250000) ispcEstimate = quarterRevenue * 0.03;
    else if (quarterRevenue <= 500000) ispcEstimate = 7500 + (quarterRevenue - 250000) * 0.04;
    else if (quarterRevenue <= 1000000) ispcEstimate = 17500 + (quarterRevenue - 500000) * 0.05;
    else ispcEstimate = quarterRevenue * 0.20;

    const quarterEndMonth = currentQuarter * 3;
    const ispcDueDate = new Date(now.getFullYear(), quarterEndMonth, 0);
    const daysUntilIspc = Math.ceil((ispcDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const financialSummary = {
      company: companyName,
      period: `${now.getFullYear()}`,
      metrics: {
        totalRevenue: Math.round(totalRevenue),
        pendingRevenue: Math.round(pendingRevenue),
        overdueRevenue: Math.round(overdueRevenue),
        totalInvoices: allInvoices.length,
        pendingInvoices: pendingInvoices.length,
        overdueInvoices: overdueInvoices.length,
        activeClients: clientCount || 0,
        activeProducts: productCount || 0,
        topClientConcentration: concentrationPct,
      },
      fiscal: {
        currentQuarter,
        quarterRevenue: Math.round(quarterRevenue),
        ispcEstimate: Math.round(ispcEstimate),
        daysUntilIspcDue: daysUntilIspc,
      },
      monthlyRevenue
    };

    // Ask Gemini to generate insights
    const modelId = await discoverModel(GEMINI_API_KEY);
    const prompt = `Você é um analista financeiro especializado em PMEs moçambicanas.
Analise os dados financeiros da empresa "${companyName}" e gere insights accionáveis em Português de Moçambique.

DADOS FINANCEIROS:
${JSON.stringify(financialSummary, null, 2)}

GERE uma análise inteligente com os campos abaixo. Cada insight deve ter:
- title: título curto e impactante
- description: explicação detalhada (2-3 frases) com números reais dos dados
- type: "warning" | "success" | "info" | "danger"
- icon: nome de ícone Material Icons (ex: "trending_up", "warning", "account_balance", "people", "schedule")
- action: (opcional) texto de botão de acção
- actionRoute: (opcional) rota Angular para navegar

Gere entre 4-6 insights relevantes. Priorize:
1. Facturas vencidas (se houver)
2. Concentração de risco em clientes
3. Obrigações fiscais ISPC (com estimativa e prazo)
4. Tendência de receitas mensais
5. Sugestões de crescimento`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2000,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                insights: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      description: { type: "STRING" },
                      type: { type: "STRING", enum: ["warning", "success", "info", "danger"] },
                      icon: { type: "STRING" },
                      action: { type: "STRING" },
                      actionRoute: { type: "STRING" }
                    },
                    required: ["title", "description", "type", "icon"]
                  }
                },
                summary: { type: "STRING" }
              },
              required: ["insights", "summary"]
            }
          }
        })
      }
    );

    if (!geminiRes.ok) throw new Error(`Gemini error: ${await geminiRes.text()}`);
    const geminiData = await geminiRes.json();
    const insightsText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsedInsights = { insights: [], summary: "" };
    try { parsedInsights = JSON.parse(insightsText); } catch { /* use empty */ }

    return new Response(
      JSON.stringify({
        metrics: financialSummary.metrics,
        fiscal: financialSummary.fiscal,
        monthlyRevenue: financialSummary.monthlyRevenue,
        insights: parsedInsights.insights,
        summary: parsedInsights.summary
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in ai-insights:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
