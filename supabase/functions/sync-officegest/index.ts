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

// NUITs de demonstração ou genéricos que nunca devem ser usados como chave única de cliente
const DUMMY_TAX_IDS = new Set([
  "123456789",
  "999999999",
  "999999990",
  "000000000",
  "111111111",
  "121212121",
  "123321123",
  "232333444",
]);

// IDs de clientes demo que NUNCA devem ser associados a empresas reais
const DEMO_CUSTOMER_IDS = new Set(["73", "82"]);

function normalizeString(str: string): string {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isDemoCustomer(cust: any, id?: string): boolean {
  if (id && DEMO_CUSTOMER_IDS.has(String(id))) return true;
  if (cust?.id && DEMO_CUSTOMER_IDS.has(String(cust.id))) return true;
  const nameNorm = normalizeString(cust?.name || "");
  if (nameNorm.includes("demomobilelegis") || nameNorm.includes("mobidemo")) return true;
  return false;
}

/**
 * Pesquisa cliente no OfficeGest por NUIT real (ignora NUITs fictícios e contas demo).
 */
async function findCustomerByNuit(nuit: string, customersMap?: Record<string, any>): Promise<{ customerId: string | null; error?: string }> {
  if (!nuit || nuit.trim() === "") return { customerId: null };
  const cleanNuit = nuit.trim();
  if (DUMMY_TAX_IDS.has(cleanNuit) || cleanNuit.length < 9) {
    return { customerId: null };
  }

  try {
    let map = customersMap;
    if (!map) {
      const res = await ogFormFetch("/entities/customers", "GET");
      if (!res.ok) {
        const errText = await res.text();
        return { customerId: null, error: `Listagem clientes (${res.status}): ${errText}` };
      }
      const data = await res.json();
      map = data?.customers ?? {};
    }

    for (const id in map) {
      const cust = map[id];
      if (!cust || isDemoCustomer(cust, id)) continue;
      if (String(cust.customertaxid).trim() === cleanNuit) {
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
 * Pesquisa cliente no OfficeGest por Nome exato / normalizado (ignora contas demo).
 */
function findCustomerByName(name: string, customersMap: Record<string, any>): string | null {
  const normName = normalizeString(name);
  if (!normName || normName === "clienteispcfacil" || normName === "consumidorfinal") {
    return null;
  }

  for (const id in customersMap) {
    const cust = customersMap[id];
    if (!cust || isDemoCustomer(cust, id)) continue;
    const custNorm = normalizeString(cust.name || "");
    if (custNorm === normName) {
      return String(cust.id || id);
    }
  }

  return null;
}

/**
 * Cria cliente no OfficeGest via form-urlencoded com os dados reais da empresa.
 * Devolve { customerId, error }.
 */
async function createCustomer(
  name: string,
  nuit: string,
  address: string,
  email: string,
  phone?: string,
): Promise<{ customerId: string | null; error?: string }> {
  try {
    const cleanNuit = (nuit || "").trim();
    const cleanName = (name || "Cliente ISPC Fácil").trim();
    const cleanAddress = (address || "Maputo, Moçambique").trim();
    const cleanEmail = (email || "").trim();
    const cleanPhone = (phone || "").trim();

    // Se o NUIT for fictício ou vazio, usar 999999990 (Consumidor Final Moçambique)
    const isValidNuit = cleanNuit.length >= 9 && !DUMMY_TAX_IDS.has(cleanNuit);
    const taxIdToUse = isValidNuit ? cleanNuit : "999999990";

    const formParams: Record<string, string> = {
      name: cleanName,
      address: cleanAddress,
      city: "Maputo",
      zipcode: "1100",
      country: "MOZ",
      customertaxid: taxIdToUse,
    };

    if (cleanEmail) {
      formParams.email = cleanEmail;
    }
    if (cleanPhone) {
      formParams.mobilephone = cleanPhone;
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
 * Resolve ou cria cliente no OfficeGest:
 * 1. Descartar cached ID se for demo ([73]).
 * 2. Buscar por NUIT real válido (se aplicável).
 * 3. Buscar por Nome real da empresa.
 * 4. Se não existir, criar novo cliente com nome e dados reais da empresa.
 */
async function resolveOrCreateCustomer(
  name: string,
  nuit: string,
  address: string,
  email: string,
  phone: string,
  cachedCustomerId?: string | null,
): Promise<{ customerId: string | null; error?: string }> {
  // Descartar ID se for cliente de teste Demo
  let validCachedId = cachedCustomerId;
  if (validCachedId && DEMO_CUSTOMER_IDS.has(String(validCachedId))) {
    validCachedId = null;
  }

  // Buscar lista actual de clientes no OfficeGest
  let customersMap: Record<string, any> = {};
  try {
    const listRes = await ogFormFetch("/entities/customers", "GET");
    if (listRes.ok) {
      const listData = await listRes.json();
      customersMap = listData?.customers ?? {};
    }
  } catch (e) {
    console.warn("[OfficeGest] Aviso ao carregar lista de clientes:", e);
  }

  // Se temos um ID em cache, verificar se é válido e não demo
  if (validCachedId && customersMap[validCachedId]) {
    const cachedCust = customersMap[validCachedId];
    if (!isDemoCustomer(cachedCust, validCachedId)) {
      console.log(`[OfficeGest] Usando cliente em cache: [${validCachedId}] ${cachedCust.name}`);
      return { customerId: String(validCachedId) };
    }
  }

  // 1. Pesquisar por NUIT real válido
  const nuitSearch = await findCustomerByNuit(nuit, customersMap);
  if (nuitSearch.customerId) {
    console.log(`[OfficeGest] Cliente encontrado por NUIT (${nuit}): [${nuitSearch.customerId}]`);
    return { customerId: nuitSearch.customerId };
  }

  // 2. Pesquisar por Nome da Empresa
  const nameSearchId = findCustomerByName(name, customersMap);
  if (nameSearchId) {
    console.log(`[OfficeGest] Cliente encontrado por Nome (${name}): [${nameSearchId}]`);
    return { customerId: nameSearchId };
  }

  // 3. Criar novo cliente no OfficeGest com os dados reais
  console.log(`[OfficeGest] Cliente não encontrado. A criar novo cliente: "${name}"`);
  const createRes = await createCustomer(name, nuit, address, email, phone);
  return createRes;
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
    let force = false;
    let reemitDemo = true;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        paymentIds = body?.payment_ids;
        force = !!body?.force;
        if (body?.reemit_demo !== undefined) {
          reemitDemo = !!body?.reemit_demo;
        }
      }
    } catch {
      // sem body é válido
    }

    // ── Buscar pagamentos a sincronizar ──────────────────────────────────────
    let query = supabase
      .from("subscription_payments")
      .select("*, companies(name, nuit, address, email, phone)")
      .eq("status", "completed");

    if (paymentIds && paymentIds.length > 0) {
      query = query.in("id", paymentIds);
      if (!force) {
        query = query.or("officegest_document_id.is.null,officegest_customer_id.eq.73");
      }
    } else {
      // Sincronização geral: pendentes de emissão OU faturas que foram geradas com o cliente demo 73
      if (reemitDemo) {
        query = query.or("officegest_document_id.is.null,officegest_customer_id.eq.73");
      } else {
        query = query.is("officegest_document_id", null);
      }
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
        JSON.stringify({ synced: 0, failed: 0, errors: [], documents: [], message: "Sem pagamentos pendentes de emissão ou actualização no OfficeGest." }),
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
      const companyPhone = company?.phone ?? payment.phone_number ?? "";

      try {
        console.log(`[SyncOfficeGest] A processar payment ${payment.id} — ${companyName}`);

        // 1. Resolver ou criar cliente no OfficeGest (garante que 73 nunca é usado)
        const previousCustomerId = (payment.officegest_customer_id === "73" || payment.officegest_customer_id === "82")
          ? null
          : payment.officegest_customer_id;

        const custResult = await resolveOrCreateCustomer(
          companyName,
          companyNuit,
          companyAddress,
          companyEmail,
          companyPhone,
          previousCustomerId,
        );

        if (!custResult.customerId) {
          throw new Error(`Não foi possível obter ou criar o cliente "${companyName}" no OfficeGest: ${custResult.error || "Erro desconhecido"}`);
        }

        const customerId = custResult.customerId;

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

        // 3. Actualizar subscription_payments com ID do documento e cliente real
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

        console.log(`[SyncOfficeGest] ✅ Payment ${payment.id} → Documento ${docResult.documentNumber} (Cliente [${customerId}])`);
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
