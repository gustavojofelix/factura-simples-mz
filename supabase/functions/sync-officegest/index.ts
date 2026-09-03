import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

/**
 * sync-officegest Edge Function
 *
 * Cria facturas no OfficeGest para cada pagamento `completed` da plataforma
 * que ainda não tenha um `officegest_document_id`.
 *
 * Pode ser invocado:
 *   - Manualmente pelo backoffice (sem body → sincroniza todos os pendentes)
 *   - Automaticamente pelo sislog-webhook (com payment_ids específicos)
 *
 * Body (opcional):
 *   { payment_ids?: string[] }
 *
 * Response:
 *   { synced: number, failed: number, errors: string[], documents: { payment_id, document_number }[] }
 */

const OFFICEGEST_BASE = Deno.env.get("OFFICEGEST_BASE_URL") || "https://lawtec.officegest.com";
const OFFICEGEST_USER = Deno.env.get("OFFICEGEST_USER") || "admin";
const OFFICEGEST_PASS = Deno.env.get("OFFICEGEST_PASS") || "vu3cPksfyR91";
const OFFICEGEST_DOCTYPE = Deno.env.get("OFFICEGEST_DOCTYPE") || "FT";
// Código do artigo de subscrição no OfficeGest (criado automaticamente se não existir)
const OFFICEGEST_ARTICLE_CODE = Deno.env.get("OFFICEGEST_ARTICLE_CODE") || "SUB-ISPCFACIL";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── OfficeGest API helpers ────────────────────────────────────────────────────

function ogAuthHeader(): string {
  const credentials = btoa(`${OFFICEGEST_USER}:${OFFICEGEST_PASS}`);
  return `Basic ${credentials}`;
}

async function ogFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const url = `${OFFICEGEST_BASE}/api/v1${path}`;
  const headers: Record<string, string> = {
    "Authorization": ogAuthHeader(),
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  return res;
}

/**
 * Pesquisa cliente no OfficeGest por NUIT.
 * Devolve o ID do cliente se encontrado, null caso contrário.
 */
async function findCustomerByNuit(nuit: string): Promise<string | null> {
  try {
    const res = await ogFetch(`/entities/customers/search`, "POST", {
      field: "nif",
      value: nuit,
    });
    if (!res.ok) return null;
    const data = await res.json();
    // A API retorna array de resultados
    const customers = Array.isArray(data) ? data : (data?.data ?? []);
    if (customers.length > 0) {
      return String(customers[0].idcliente ?? customers[0].id ?? "");
    }
    return null;
  } catch (e) {
    console.error("[OfficeGest] Erro ao pesquisar cliente por NUIT:", e);
    return null;
  }
}

/**
 * Cria cliente no OfficeGest.
 * Devolve o ID do cliente criado ou null em caso de erro.
 */
async function createCustomer(name: string, nuit: string, address: string, email: string): Promise<string | null> {
  try {
    const payload = {
      nome: name,
      nif: nuit || "000000000",
      morada: address || "Moçambique",
      email: email || "",
      pais: "MZ",
      moeda: "MZN",
    };
    const res = await ogFetch("/entities/customers", "POST", payload);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[OfficeGest] Erro ao criar cliente (${res.status}): ${errText}`);
      return null;
    }
    const data = await res.json();
    return String(data?.idcliente ?? data?.id ?? data?.data?.idcliente ?? "");
  } catch (e) {
    console.error("[OfficeGest] Exceção ao criar cliente:", e);
    return null;
  }
}

/**
 * Garante que o artigo de subscrição existe no OfficeGest.
 * Cria-o se não existir.
 */
async function ensureArticleExists(): Promise<boolean> {
  try {
    // Verificar se artigo existe
    const res = await ogFetch(`/stocks/articles/${OFFICEGEST_ARTICLE_CODE}`, "GET");
    if (res.ok) {
      console.log(`[OfficeGest] Artigo ${OFFICEGEST_ARTICLE_CODE} já existe.`);
      return true;
    }

    // Criar artigo
    console.log(`[OfficeGest] A criar artigo de subscrição ${OFFICEGEST_ARTICLE_CODE}...`);
    const createRes = await ogFetch("/stocks/articles", "POST", {
      codartigo: OFFICEGEST_ARTICLE_CODE,
      nome: "Subscrição ISPC Fácil",
      descricao: "Subscrição da plataforma de facturação ISPC Fácil",
      preco1: 0,        // preço base (será substituído pela linha da factura)
      iva: 0,           // sem IVA
      familia: "SERV",
      unidade: "MES",
      tipoproduto: "S", // Serviço
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`[OfficeGest] Erro ao criar artigo (${createRes.status}): ${errText}`);
      return false;
    }

    console.log(`[OfficeGest] Artigo ${OFFICEGEST_ARTICLE_CODE} criado com sucesso.`);
    return true;
  } catch (e) {
    console.error("[OfficeGest] Exceção ao verificar/criar artigo:", e);
    return false;
  }
}

/**
 * Cria um documento de venda (FT) no OfficeGest.
 * Devolve { documentId, documentNumber } ou null em caso de erro.
 */
async function createSalesDocument(
  customerId: string,
  customerName: string,
  amount: number,
  planName: string,
  billingCycle: string,
  paymentMethod: string,
  paymentDate: string,
  referenceCode: string,
): Promise<{ documentId: string; documentNumber: string } | null> {
  try {
    const cycleLabel = billingCycle === "yearly" ? "Anual (12 meses)"
      : billingCycle === "semiannual" ? "Semestral (6 meses)"
      : billingCycle === "quarterly" ? "Trimestral (3 meses)"
      : "Mensal (1 mês)";

    const methodLabel = paymentMethod === "mpesa" ? "M-Pesa"
      : paymentMethod === "emola" ? "e-Mola"
      : paymentMethod;

    const docDate = paymentDate
      ? new Date(paymentDate).toISOString().substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    const payload = {
      idcliente: customerId,
      data: docDate,
      moeda: "MZN",
      cambio: 1,
      observacoes: `Referência: ${referenceCode} | Método: ${methodLabel}`,
      linhas: [
        {
          codartigo: OFFICEGEST_ARTICLE_CODE,
          descricao: `Subscrição ISPC Fácil — Plano ${planName} (${cycleLabel})`,
          quantidade: 1,
          preco: amount,
          desconto: 0,
          iva: 0,
        },
      ],
    };

    const res = await ogFetch(`/sales/documents/${OFFICEGEST_DOCTYPE}`, "POST", payload);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[OfficeGest] Erro ao criar documento (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const documentId = String(data?.id ?? data?.iddocumento ?? data?.data?.id ?? "");
    const documentNumber = String(data?.numerodoc ?? data?.numero ?? data?.data?.numerodoc ?? documentId);

    if (!documentId) {
      console.error("[OfficeGest] Documento criado mas sem ID na resposta:", JSON.stringify(data));
      return null;
    }

    return { documentId, documentNumber };
  } catch (e) {
    console.error("[OfficeGest] Exceção ao criar documento:", e);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log(`[SyncOfficeGest] ${req.method} ${req.url}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Ler body opcional
    let paymentIds: string[] | undefined;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        paymentIds = body?.payment_ids;
      }
    } catch {
      // sem body é válido
    }

    // ── Garantir artigo de subscrição ────────────────────────────────────────
    await ensureArticleExists();

    // ── Buscar pagamentos a sincronizar ──────────────────────────────────────
    let query = supabase
      .from("subscription_payments")
      .select("*, companies(name, nuit, address, email:user_id(email))")
      .eq("status", "completed")
      .is("officegest_document_id", null);

    if (paymentIds && paymentIds.length > 0) {
      query = query.in("id", paymentIds);
    }

    const { data: payments, error: fetchError } = await query;

    if (fetchError) {
      console.error("[SyncOfficeGest] Erro ao buscar pagamentos:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, failed: 0, errors: [], documents: [], message: "Sem pagamentos para sincronizar." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[SyncOfficeGest] A processar ${payments.length} pagamento(s)...`);

    const results = { synced: 0, failed: 0, errors: [] as string[], documents: [] as { payment_id: string; document_number: string }[] };

    for (const payment of payments) {
      const company = payment.companies as any;
      const companyName = company?.name ?? "Cliente ISPC Fácil";
      const companyNuit = company?.nuit ?? "";
      const companyAddress = company?.address ?? "Moçambique";
      const companyEmail = company?.email ?? "";

      try {
        console.log(`[SyncOfficeGest] A processar payment ${payment.id} — ${companyName}`);

        // 1. Encontrar ou criar cliente no OfficeGest
        let customerId = payment.officegest_customer_id || null;

        if (!customerId && companyNuit) {
          customerId = await findCustomerByNuit(companyNuit);
          if (customerId) {
            console.log(`[SyncOfficeGest] Cliente encontrado no OfficeGest: ${customerId}`);
          }
        }

        if (!customerId) {
          console.log(`[SyncOfficeGest] A criar cliente no OfficeGest: ${companyName}`);
          customerId = await createCustomer(companyName, companyNuit, companyAddress, companyEmail);
        }

        if (!customerId) {
          throw new Error(`Não foi possível encontrar ou criar o cliente "${companyName}" no OfficeGest`);
        }

        // 2. Criar documento de venda
        const docResult = await createSalesDocument(
          customerId,
          companyName,
          Number(payment.amount) || 0,
          payment.plan_name ?? "Standard",
          payment.billing_cycle ?? "monthly",
          payment.payment_method ?? "",
          payment.created_at ?? new Date().toISOString(),
          payment.reference_code ?? payment.id,
        );

        if (!docResult) {
          throw new Error(`Falha ao criar documento no OfficeGest para o pagamento ${payment.id}`);
        }

        // 3. Actualizar subscription_payments com ID do documento
        const { error: updateError } = await supabase
          .from("subscription_payments")
          .update({
            officegest_document_id: docResult.documentId,
            officegest_document_number: docResult.documentNumber,
            officegest_customer_id: customerId,
            officegest_synced_at: new Date().toISOString(),
          })
          .eq("id", payment.id);

        if (updateError) {
          console.error(`[SyncOfficeGest] Erro ao actualizar payment ${payment.id}:`, updateError);
          throw updateError;
        }

        console.log(`[SyncOfficeGest] ✅ Payment ${payment.id} → Documento ${docResult.documentNumber}`);
        results.synced++;
        results.documents.push({ payment_id: payment.id, document_number: docResult.documentNumber });

      } catch (err: any) {
        console.error(`[SyncOfficeGest] ❌ Erro no payment ${payment.id}:`, err);
        results.failed++;
        results.errors.push(`${companyName}: ${err?.message ?? String(err)}`);
      }
    }

    console.log(`[SyncOfficeGest] Concluído — ${results.synced} sincronizados, ${results.failed} erros`);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[SyncOfficeGest] Erro geral:", error);
    return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
