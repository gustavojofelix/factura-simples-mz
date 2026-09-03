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
const OFFICEGEST_HASH = Deno.env.get("OFFICEGEST_HASH") || "f9b7aa18f67ca92aa3f615c64222b2ff0f77b148";
const OFFICEGEST_DOCTYPE = Deno.env.get("OFFICEGEST_DOCTYPE") || "FT";
// Artigo criado no OfficeGest para representar as subscrições
const OFFICEGEST_ARTICLE_ID = Deno.env.get("OFFICEGEST_ARTICLE_ID") || "LFSUXT";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── OfficeGest API helpers ────────────────────────────────────────────────────

function ogAuthHeader(): string {
  const credentials = btoa(`${OFFICEGEST_USER}:${OFFICEGEST_HASH}`);
  return `Basic ${credentials}`;
}

async function ogFormFetch(path: string, method = "GET", formParams?: Record<string, string>): Promise<Response> {
  const url = `${OFFICEGEST_BASE}/api${path}`;
  const headers: Record<string, string> = {
    "Authorization": ogAuthHeader(),
    "Accept": "application/json",
  };

  const options: RequestInit = { method, headers };
  if (formParams && (method === "POST" || method === "PUT" || method === "PATCH")) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(formParams).toString();
  }

  const res = await fetch(url, options);
  return res;
}

/**
 * Pesquisa cliente no OfficeGest por NUIT ou nome.
 * A API do OfficeGest lista os clientes em /entities/customers.
 */
async function findCustomerByNuit(nuit: string): Promise<{ customerId: string | null; error?: string }> {
  if (!nuit || nuit.trim() === "" || nuit === "000000000") return { customerId: null };
  try {
    const cleanNuit = nuit.trim();
    const res = await ogFormFetch("/entities/customers", "GET");
    if (!res.ok) {
      const errText = await res.text();
      return { customerId: null, error: `Listagem clientes (${res.status}): ${errText}` };
    }
    const data = await res.json();
    const customersMap = data?.customers ?? {};
    for (const id in customersMap) {
      const cust = customersMap[id];
      if (cust && String(cust.customertaxid).trim() === cleanNuit) {
        return { customerId: String(cust.id || id) };
      }
    }
    return { customerId: null };
  } catch (e: any) {
    console.error("[OfficeGest] Erro ao pesquisar cliente por NUIT:", e);
    return { customerId: null, error: e?.message ?? String(e) };
  }
}

/**
 * Cria cliente no OfficeGest via form-urlencoded.
 * Devolve { customerId, error }.
 */
async function createCustomer(
  name: string,
  nuit: string,
  address: string,
  email: string
): Promise<{ customerId: string | null; error?: string }> {
  try {
    const cleanNuit = (nuit || "").trim();
    const cleanName = (name || "Cliente ISPC Fácil").trim();
    const cleanAddress = (address || "Maputo, Moçambique").trim();
    const cleanEmail = (email || "").trim();

    const formParams: Record<string, string> = {
      name: cleanName,
      address: cleanAddress,
      city: "Maputo",
      zipcode: "1100",
      country: "MOZ",
      customertaxid: cleanNuit || "999999999",
    };

    if (cleanEmail) {
      formParams.email = cleanEmail;
    }

    const res = await ogFormFetch("/entities/customers", "POST", formParams);
    const resText = await res.text();

    if (!res.ok) {
      console.error(`[OfficeGest] Erro ao criar cliente (${res.status}): ${resText}`);
      let parsedErr = "";
      try {
        const jsonErr = JSON.parse(resText);
        parsedErr = jsonErr.code_desc || jsonErr.message || resText;
      } catch {
        parsedErr = resText;
      }
      return { customerId: null, error: `HTTP ${res.status}: ${parsedErr}` };
    }

    let data: any = {};
    try {
      data = JSON.parse(resText);
    } catch {
      data = {};
    }

    if (data.result === "error") {
      return { customerId: null, error: `${data.code_desc || "Erro ao criar cliente"} (${data.arg_missing || data.invalid_value || ""})` };
    }

    const customerId = String(data?.customer_id ?? data?.customer?.id ?? data?.id ?? "");
    if (!customerId) {
      return { customerId: null, error: `Cliente criado mas sem ID retornado: ${resText}` };
    }

    return { customerId };
  } catch (e: any) {
    console.error("[OfficeGest] Exceção ao criar cliente:", e);
    return { customerId: null, error: e?.message ?? String(e) };
  }
}

/**
 * Cria um documento de venda (FT) no OfficeGest.
 * Devolve { documentId, documentNumber, error }
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
): Promise<{ documentId: string; documentNumber: string } | { error: string }> {
  try {
    const cycleLabel = billingCycle === "yearly" ? "Anual (12 meses)"
      : billingCycle === "semiannual" ? "Semestral (6 meses)"
      : billingCycle === "quarterly" ? "Trimestral (3 meses)"
      : "Mensal (1 mês)";

    const methodLabel = paymentMethod === "mpesa" ? "M-Pesa"
      : paymentMethod === "emola" ? "e-Mola"
      : paymentMethod || "Pagamento Electrónico";

    // Regra fiscal (OfficeGest / AT Moçambique): A data do documento não pode ser anterior
    // ao último documento emitido na série. Usamos a data de hoje para emissão fiscal
    // e incluímos a data real do pagamento nas observações.
    const today = new Date().toISOString().substring(0, 10);
    const paidAtFormatted = paymentDate ? new Date(paymentDate).toLocaleDateString("pt-MZ") : today;

    const formParams: Record<string, string> = {
      idcustomer: customerId,
      date: today,
      currency: "MT",
      observations: `Ref: ${referenceCode} | Pago em: ${paidAtFormatted} | Plano: ${planName} (${cycleLabel}) | Método: ${methodLabel}`,
      "lines[1][idarticle]": OFFICEGEST_ARTICLE_ID,
      "lines[1][description]": `Subscrição ISPC Fácil — Plano ${planName} (${cycleLabel})`,
      "lines[1][quantity]": "1",
      "lines[1][sellingprice]": String(amount),
      "lines[1][vat]": "0",
    };

    const res = await ogFormFetch(`/sales/documents/${OFFICEGEST_DOCTYPE}`, "POST", formParams);
    const resText = await res.text();

    if (!res.ok) {
      console.error(`[OfficeGest] Erro ao criar documento (${res.status}): ${resText}`);
      let parsedErr = "";
      try {
        const jsonErr = JSON.parse(resText);
        parsedErr = jsonErr.code_desc || jsonErr.message || resText;
      } catch {
        parsedErr = resText;
      }
      return { error: `Documento FT (${res.status}): ${parsedErr}` };
    }

    let data: any = {};
    try {
      data = JSON.parse(resText);
    } catch {
      data = {};
    }

    if (data.result === "error") {
      const detail = data.codeerror || data.arg_missing || data.invalid_value || "";
      return { error: `${data.code_desc || "Erro ao emitir documento"} ${detail ? `(${detail})` : ""}` };
    }

    const documentNumber = String(data?.document?.documentnumber ?? data?.document_number ?? "");
    const documentId = String(data?.document?.number ?? data?.document_number ?? "");

    if (!documentNumber && !documentId) {
      return { error: `Documento criado mas sem número retornado: ${resText}` };
    }

    return { documentId: documentId || documentNumber, documentNumber: documentNumber || documentId };
  } catch (e: any) {
    console.error("[OfficeGest] Exceção ao criar documento de venda:", e);
    return { error: e?.message ?? String(e) };
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

    // ── Buscar pagamentos a sincronizar ──────────────────────────────────────
    let query = supabase
      .from("subscription_payments")
      .select("*, companies(name, nuit, address)")
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
      const companyEmail = "";

      try {
        console.log(`[SyncOfficeGest] A processar payment ${payment.id} — ${companyName}`);

        // 1. Encontrar ou criar cliente no OfficeGest
        let customerId = payment.officegest_customer_id || null;

        if (!customerId && companyNuit) {
          const searchRes = await findCustomerByNuit(companyNuit);
          if (searchRes.customerId) {
            customerId = searchRes.customerId;
            console.log(`[SyncOfficeGest] Cliente encontrado no OfficeGest: ${customerId}`);
          }
        }

        if (!customerId) {
          console.log(`[SyncOfficeGest] A criar cliente no OfficeGest: ${companyName}`);
          const createRes = await createCustomer(companyName, companyNuit, companyAddress, companyEmail);
          if (createRes.customerId) {
            customerId = createRes.customerId;
          } else {
            throw new Error(`Não foi possível criar cliente no OfficeGest: ${createRes.error || "Erro desconhecido"}`);
          }
        }

        if (!customerId) {
          throw new Error(`Não foi possível obter ou criar o cliente "${companyName}" no OfficeGest`);
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

        if ("error" in docResult || !docResult.documentId) {
          const errorMsg = ("error" in docResult) ? docResult.error : "ID de documento em falta";
          throw new Error(`Falha ao criar FT no OfficeGest: ${errorMsg}`);
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
