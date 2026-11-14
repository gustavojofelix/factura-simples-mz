// Acesso à API do OfficeGest (facturação das subscrições da plataforma).
//
// As facturas das subscrições são emitidas no OfficeGest por sync-officegest.
// fetchOfficeGestInvoicePdf descarrega o PDF oficial dessa factura para ser
// anexado ao e-mail de confirmação do pagamento. Nunca lança excepção.

export const OFFICEGEST_BASE = (Deno.env.get("OFFICEGEST_BASE_URL") || "https://lawtec.officegest.com").replace(/\/+$/, "");
const OFFICEGEST_USER = Deno.env.get("OFFICEGEST_USER") || "admin";
const OFFICEGEST_HASH = Deno.env.get("OFFICEGEST_HASH") || "f9b7aa18f67ca92aa3f615c64222b2ff0f77b148";
export const OFFICEGEST_DOCTYPE = Deno.env.get("OFFICEGEST_DOCTYPE") || "FT";

/** Tempo máximo de cada pedido ao OfficeGest ao gerar o PDF. */
const PDF_TIMEOUT_MS = 20_000;
/** Um PDF de uma factura simples nunca chega perto disto. */
const MAX_PDF_BYTES = 8_000_000;

export function ogAuthHeader(): string {
  return `Basic ${btoa(`${OFFICEGEST_USER}:${OFFICEGEST_HASH}`)}`;
}

export async function ogFormFetch(
  path: string,
  method = "GET",
  formParams?: Record<string, string>,
  init: { signal?: AbortSignal; accept?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Authorization": ogAuthHeader(),
    "Accept": init.accept ?? "application/json",
  };
  const options: RequestInit = { method, headers, signal: init.signal };
  if (formParams && (method === "POST" || method === "PUT" || method === "PATCH")) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(formParams).toString();
  }
  return await fetch(`${OFFICEGEST_BASE}/api${path}`, options);
}

export type InvoicePdfResult =
  | { ok: true; content: Uint8Array; filename: string }
  | { ok: false; error: string };

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF"
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const clean = value.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Nome de ficheiro a partir do número do documento ("FT 2026/15" → "Factura_FT-2026-15.pdf"). */
export function invoicePdfFilename(documentNumber: string | null | undefined): string {
  const safe = String(documentNumber || "subscricao").trim().replace(/[\/\\\s]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return `Factura_${safe || "subscricao"}.pdf`;
}

/** Procura na resposta JSON um campo que traga o PDF (base64 ou ligação). */
function findPdfCandidates(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value === "string") return out;
  if (Array.isArray(value)) {
    for (const item of value) findPdfCandidates(item, depth + 1, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && /pdf|print|file|link|url|base64/i.test(key) && v.length > 8) {
        out.push(v);
      } else if (typeof v === "object") {
        findPdfCandidates(v, depth + 1, out);
      }
    }
  }
  return out;
}

async function bytesFromCandidate(candidate: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const value = candidate.trim();
  if (/^https?:\/\//i.test(value)) {
    // Ligação temporária ao PDF. Só envia credenciais ao próprio OfficeGest.
    const sameHost = value.startsWith(OFFICEGEST_BASE);
    const res = await fetch(value, {
      headers: sameHost ? { "Authorization": ogAuthHeader(), "Accept": "application/pdf" } : { "Accept": "application/pdf" },
      signal,
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPdf(bytes) ? bytes : null;
  }
  if (/^data:application\/pdf;base64,/i.test(value) || value.startsWith("JVBER")) {
    const bytes = base64ToBytes(value);
    return bytes && isPdf(bytes) ? bytes : null;
  }
  return null;
}

/**
 * PDF oficial (2.ª via com valores, A4) da factura emitida no OfficeGest.
 * `documentId` é subscription_payments.officegest_document_id (número interno
 * do documento no OfficeGest).
 */
export async function fetchOfficeGestInvoicePdf(
  documentId: string | null | undefined,
  documentNumber?: string | null,
): Promise<InvoicePdfResult> {
  if (!documentId) return { ok: false, error: "Factura ainda não emitida no OfficeGest." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  try {
    const path = `/sales/documents/${encodeURIComponent(OFFICEGEST_DOCTYPE)}/${encodeURIComponent(String(documentId))}` +
      `?print=A&print_with_values=T`;
    const res = await ogFormFetch(path, "GET", undefined, {
      signal: controller.signal,
      accept: "application/pdf, application/json",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `OfficeGest (${res.status}): ${text.slice(0, 200)}` };
    }

    const contentType = res.headers.get("content-type") || "";
    let bytes: Uint8Array | null = null;

    if (/application\/(pdf|octet-stream)/i.test(contentType)) {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (!isPdf(bytes)) bytes = null;
    } else {
      const text = await res.text();
      if (text.startsWith("%PDF")) {
        bytes = new TextEncoder().encode(text);
      } else {
        let data: unknown = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        for (const candidate of findPdfCandidates(data)) {
          bytes = await bytesFromCandidate(candidate, controller.signal).catch(() => null);
          if (bytes) break;
        }
        if (!bytes) {
          const keys = data && typeof data === "object" ? Object.keys(data as object).join(",") : typeof data;
          console.warn(`[officegest] resposta sem PDF para o documento ${documentId} (content-type=${contentType}; chaves=${keys}): ${text.slice(0, 300)}`);
        }
      }
    }

    if (!bytes) return { ok: false, error: "O OfficeGest não devolveu o PDF da factura." };
    if (bytes.length > MAX_PDF_BYTES) return { ok: false, error: "PDF da factura demasiado grande." };
    return { ok: true, content: bytes, filename: invoicePdfFilename(documentNumber) };
  } catch (e) {
    const message = (e as Error)?.name === "AbortError" ? "Tempo esgotado ao obter o PDF no OfficeGest." : (e as Error)?.message || String(e);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
