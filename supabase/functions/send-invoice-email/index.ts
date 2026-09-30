import "@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@6.9.11";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Tecto para o anexo. O PDF é gerado no browser e enviado em base64, por isso
 * um documento anormalmente grande é sinal de erro e não de uso legítimo.
 * 10 milhões de caracteres correspondem a cerca de 7,5 MB de ficheiro.
 */
const MAX_PDF_BASE64_LENGTH = 10_000_000;

/** Tecto para o logótipo embutido na mensagem. */
const MAX_LOGO_BASE64_LENGTH = 600_000;

type DocumentKind = "factura" | "recibo";

interface RequestBody {
  invoice_id?: string;
  pdf_base64?: string;
  document_kind?: DocumentKind;
  payment_id?: string;
  to_email?: string;
}

interface Branding {
  primary_color: string;
  accent_color: string;
  thank_you_message: string;
  footer_text: string;
  email_subject: string;
  email_greeting: string;
  email_body: string;
  email_signature: string;
  receipt_email_subject: string;
  receipt_email_body: string;
  email_reply_to: string | null;
}

const BRANDING_DEFAULTS: Branding = {
  primary_color: "#f16c39",
  accent_color: "#332d2a",
  thank_you_message: "",
  footer_text: "",
  email_subject: "Factura {{numero_factura}} - {{empresa}}",
  email_greeting: "Olá {{cliente}},",
  email_body:
    "Confirmamos a emissão do documento {{numero_factura}}. Segue em anexo a sua factura em formato PDF com todos os detalhes de facturação.",
  email_signature: "Com os melhores cumprimentos,",
  receipt_email_subject: "Recibo de pagamento - {{empresa}}",
  receipt_email_body:
    "Confirmamos a recepção do pagamento de {{valor_pago}} referente à factura {{numero_factura}}. Segue o recibo em anexo.",
  email_reply_to: null,
};

function jsonError(message: string, code: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message, code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Escapa valores antes de os interpolar no HTML da mensagem. O nome do cliente
 * e os textos escritos pela empresa são texto livre e não podem entrar crus.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Remove quebras de linha de um cabeçalho. Sem isto, um nome com uma quebra de
 * linha permitiria injectar cabeçalhos na mensagem.
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Substitui os marcadores escritos pela empresa.
 *
 * Um marcador desconhecido fica tal e qual, em vez de desaparecer. É melhor
 * retorno para quem escreveu {{clientes}} por engano do que um espaço vazio.
 */
function renderTemplate(
  text: string,
  values: Record<string, string>,
  escape: boolean,
): string {
  return String(text ?? "").replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (match, key: string) => {
      const value = values[key.toLowerCase()];
      if (value === undefined) return match;
      return escape ? escapeHtml(value) : value;
    },
  );
}

function formatCurrency(value: unknown): string {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("pt-MZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + " MZN";
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-MZ");
}

function normalizeHex(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback;
}

/**
 * Escolhe texto escuro ou claro conforme a luminosidade do fundo, para que uma
 * cor de marca clara não produza texto branco ilegível no cabeçalho.
 */
function readableTextOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) +
    0.0722 * channel(b);
  return luminance > 0.45 ? "#1f1a17" : "#ffffff";
}

/**
 * As relações embutidas do PostgREST chegam como objecto quando a cardinalidade
 * é reconhecida e como lista quando não é. Esta função aceita as duas formas.
 */
function firstOf<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function buildTransport() {
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");

  if (!host || !user || !pass) {
    throw new Error("SMTP_CONFIG_MISSING");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * Prepara o logótipo para ser embutido na mensagem.
 *
 * O logótipo está guardado como endereço de dados. Um endereço desses dentro de
 * uma imagem é removido pelo Gmail e pelo Outlook, por isso segue como anexo
 * referenciado. O conteúdo em base64 que já temos serve directamente, sem
 * precisar de armazenamento externo.
 */
function buildLogoAttachment(logoUrl: unknown) {
  const raw = String(logoUrl ?? "");
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (!match) return null;

  const [, contentType, base64] = match;
  if (base64.length > MAX_LOGO_BASE64_LENGTH) return null;

  const extension = contentType.split("/")[1].replace("jpeg", "jpg");

  return {
    filename: `logo.${extension}`,
    content: base64,
    encoding: "base64" as const,
    contentType,
    cid: "companylogo",
  };
}

function buildHtml(options: {
  brand: string;
  onBrand: string;
  accent: string;
  hasLogo: boolean;
  companyName: string;
  greeting: string;
  body: string;
  thanks: string;
  signature: string;
  documentLabel: string;
  documentNumber: string;
  amountLabel: string;
  amountValue: string;
  footerText: string;
}): string {
  const {
    brand,
    onBrand,
    accent,
    hasLogo,
    companyName,
    greeting,
    body,
    thanks,
    signature,
    documentLabel,
    documentNumber,
    amountLabel,
    amountValue,
    footerText,
  } = options;

  const header = hasLogo
    ? `<img src="cid:companylogo" alt="${companyName}" style="max-height:44px;display:block;">`
    : `<span style="font-size:22px;font-weight:800;color:${onBrand};">${companyName}</span>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentLabel} ${documentNumber}</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f5f4;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f7f5f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e0dd;">

          <tr>
            <td align="left" style="padding:26px 40px;background-color:${brand};">
              ${header}
            </td>
          </tr>

          <tr>
            <td style="padding:40px;color:#332d2a;line-height:1.6;">
              <h1 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#332d2a;">${greeting}</h1>
              <p style="margin:0 0 24px 0;font-size:15px;color:#5a524e;">${body}</p>

              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fcfbfa;border:1px dashed #e5e0dd;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;font-size:13px;color:#8c827d;">${documentLabel}</td>
                  <td style="padding:16px 20px;font-size:13px;color:#8c827d;" align="right">${amountLabel}</td>
                </tr>
                <tr>
                  <td style="padding:0 20px 16px;font-size:16px;font-weight:700;color:#332d2a;">${documentNumber}</td>
                  <td style="padding:0 20px 16px;font-size:16px;font-weight:700;color:${brand};" align="right">${amountValue}</td>
                </tr>
              </table>

              ${thanks ? `<p style="margin:0 0 24px 0;font-size:15px;font-weight:600;color:${accent};">${thanks}</p>` : ""}

              <p style="margin:0;font-size:15px;font-weight:600;color:#332d2a;">${signature}</p>
              <p style="margin:4px 0 0 0;font-size:15px;font-weight:700;color:${brand};">${companyName}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px;background-color:${accent};color:#c9c2be;font-size:12px;">
              <p style="margin:0 0 6px 0;font-size:14px;font-weight:700;color:#ffffff;">${companyName}</p>
              ${footerText ? `<p style="margin:0 0 10px 0;font-size:11px;color:#c9c2be;">${footerText}</p>` : ""}
              <p style="margin:0;font-size:11px;color:#a69b97;">Enviado através do ISPC Fácil.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // --- Autenticação ---------------------------------------------------------
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

  const { invoice_id, pdf_base64, to_email, payment_id } = body;
  const documentKind: DocumentKind = body.document_kind === "recibo"
    ? "recibo"
    : "factura";

  if (!invoice_id || !pdf_base64) {
    return jsonError(
      "Faltam campos obrigatórios (invoice_id, pdf_base64).",
      "BAD_REQUEST",
      400,
    );
  }

  if (documentKind === "recibo" && !payment_id) {
    return jsonError(
      "Falta identificar o pagamento do recibo.",
      "BAD_REQUEST",
      400,
    );
  }

  if (pdf_base64.length > MAX_PDF_BASE64_LENGTH) {
    return jsonError(
      "O documento anexo é demasiado grande.",
      "ATTACHMENT_TOO_LARGE",
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Cliente com o JWT do utilizador: tudo o que se lê passa pelo RLS, que é o
  // que garante que quem envia pertence à empresa emissora.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonError("Sessão inválida ou expirada.", "UNAUTHENTICATED", 401);
  }

  // --- Leitura da factura ---------------------------------------------------
  const { data: invoice, error: invoiceError } = await userClient
    .from("invoices")
    .select(
      "id, invoice_number, status, company_id, total, amount_paid, amount_pending, date, due_date, " +
        "client:clients (name, email), " +
        "company:companies (name, email, logo_url)",
    )
    .eq("id", invoice_id)
    .maybeSingle();

  if (invoiceError) {
    console.error("Erro ao ler a factura:", invoiceError);
    return jsonError("Não foi possível ler a factura.", "READ_FAILED", 500);
  }

  if (!invoice) {
    return jsonError(
      "Factura não encontrada ou sem permissão de acesso.",
      "FORBIDDEN",
      403,
    );
  }

  if (invoice.status === "rascunho") {
    return jsonError(
      "Não é possível enviar um rascunho por e-mail.",
      "INVOICE_IS_DRAFT",
      400,
    );
  }

  const client = firstOf<{ name?: string; email?: string }>(invoice.client);
  const company = firstOf<{ name?: string; email?: string; logo_url?: string }>(
    invoice.company,
  );
  const clientEmail = client?.email?.trim();

  if (!clientEmail) {
    return jsonError(
      "O cliente associado a esta factura não possui endereço de e-mail.",
      "CLIENT_WITHOUT_EMAIL",
      400,
    );
  }

  // O destinatário não é escolhido por quem chama a função.
  if (to_email && to_email.trim().toLowerCase() !== clientEmail.toLowerCase()) {
    return jsonError(
      "O destinatário não corresponde ao cliente desta factura.",
      "RECIPIENT_NOT_ALLOWED",
      400,
    );
  }

  // --- Pagamento, quando se trata de um recibo ------------------------------
  let payment: {
    id: string;
    amount: number;
    payment_date: string;
    receipt_number: string | null;
  } | null = null;

  if (documentKind === "recibo") {
    const { data: paymentRow, error: paymentError } = await userClient
      .from("payments")
      .select("id, amount, payment_date, invoice_id, receipt_number")
      .eq("id", payment_id!)
      .maybeSingle();

    if (paymentError) {
      console.error("Erro ao ler o pagamento:", paymentError);
      return jsonError("Não foi possível ler o pagamento.", "READ_FAILED", 500);
    }

    if (!paymentRow || paymentRow.invoice_id !== invoice.id) {
      return jsonError(
        "Pagamento não encontrado nesta factura.",
        "PAYMENT_NOT_FOUND",
        404,
      );
    }

    payment = paymentRow;
  }

  // --- Personalização da empresa -------------------------------------------
  const { data: settingsRow } = await userClient
    .from("document_settings")
    .select("*")
    .eq("company_id", invoice.company_id)
    .maybeSingle();

  const branding: Branding = { ...BRANDING_DEFAULTS };
  if (settingsRow) {
    for (const key of Object.keys(BRANDING_DEFAULTS) as Array<keyof Branding>) {
      const value = (settingsRow as Record<string, unknown>)[key];
      if (value !== null && value !== undefined) {
        (branding as Record<string, unknown>)[key] = value;
      }
    }
  }

  const companyName = company?.name?.trim() || "ISPC Fácil";
  const clientName = client?.name?.trim() || "Cliente";
  const invoiceNumber = invoice.invoice_number ?? "ND";
  const receiptNumber = payment
    ? payment.receipt_number ||
      `REC-${payment.id.substring(0, 8).toUpperCase()}`
    : "";

  const tokens: Record<string, string> = {
    cliente: clientName,
    empresa: companyName,
    numero_factura: String(invoiceNumber),
    numero_recibo: receiptNumber,
    total: formatCurrency(invoice.total),
    valor_pago: formatCurrency(payment ? payment.amount : invoice.amount_paid),
    valor_pendente: formatCurrency(invoice.amount_pending),
    data: formatDate(payment ? payment.payment_date : invoice.date),
    data_vencimento: formatDate(invoice.due_date),
  };

  const isReceipt = documentKind === "recibo";

  const subjectTemplate = isReceipt
    ? branding.receipt_email_subject
    : branding.email_subject;
  const bodyTemplate = isReceipt
    ? branding.receipt_email_body
    : branding.email_body;

  const subject = sanitizeHeader(renderTemplate(subjectTemplate, tokens, false));
  const greeting = renderTemplate(branding.email_greeting, tokens, true);
  const bodyHtml = renderTemplate(bodyTemplate, tokens, true)
    .replace(/\n/g, "<br>");
  const bodyText = renderTemplate(bodyTemplate, tokens, false);
  const thanks = renderTemplate(branding.thank_you_message, tokens, true);
  const signature = renderTemplate(branding.email_signature, tokens, true);
  const footerText = renderTemplate(branding.footer_text, tokens, true);

  // --- Envio ----------------------------------------------------------------
  try {
    const transporter = buildTransport();
    const fromAddress = Deno.env.get("SMTP_FROM_EMAIL") ??
      Deno.env.get("SMTP_USER")!;

    const base64Data = pdf_base64.replace(
      /^data:application\/pdf;base64,/,
      "",
    );

    const brand = normalizeHex(branding.primary_color, "#f16c39");
    const accent = normalizeHex(branding.accent_color, "#332d2a");
    const logo = buildLogoAttachment(company?.logo_url);

    const documentLabel = isReceipt ? "Recibo" : "Factura";
    const documentNumber = isReceipt ? receiptNumber : String(invoiceNumber);
    const attachmentName = `${documentLabel}_${
      documentNumber.replace(/\//g, "-")
    }.pdf`;

    const html = buildHtml({
      brand,
      onBrand: readableTextOn(brand),
      accent,
      hasLogo: !!logo,
      companyName: escapeHtml(companyName),
      greeting,
      body: bodyHtml,
      thanks,
      signature,
      documentLabel,
      documentNumber: escapeHtml(documentNumber),
      amountLabel: isReceipt ? "Valor pago" : "Total",
      amountValue: escapeHtml(
        isReceipt ? tokens.valor_pago : tokens.total,
      ),
      footerText,
    });

    const attachments: Record<string, unknown>[] = [
      {
        filename: attachmentName,
        content: base64Data,
        encoding: "base64",
      },
    ];
    if (logo) attachments.push(logo);

    // O servidor de correio é o da plataforma. Enviar em nome do domínio da
    // empresa faria a mensagem falhar a autenticação do domínio e cair em spam,
    // por isso a marca vai no nome do remetente e as respostas são reencaminhadas.
    const replyTo = branding.email_reply_to?.trim() || company?.email?.trim();

    const info = await transporter.sendMail({
      from: `"${sanitizeHeader(companyName).replace(/"/g, "")} via ISPC Fácil" <${fromAddress}>`,
      sender: fromAddress,
      replyTo: replyTo || undefined,
      to: clientEmail,
      subject,
      text:
        `${renderTemplate(branding.email_greeting, tokens, false)}\n\n${bodyText}\n\n${
          renderTemplate(branding.email_signature, tokens, false)
        }\n${companyName}`,
      html,
      attachments,
    });

    console.log("Message sent: %s", info.messageId);

    return new Response(
      JSON.stringify({ success: true, messageId: info.messageId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = (error as Error).message;

    if (message === "SMTP_CONFIG_MISSING") {
      console.error(
        "Faltam as variáveis SMTP_HOST, SMTP_USER ou SMTP_PASS na configuração da função.",
      );
      return jsonError(
        "O serviço de e-mail não está configurado.",
        "SMTP_CONFIG_MISSING",
        503,
      );
    }

    console.error("Failed to send email:", error);
    return jsonError("Não foi possível enviar o e-mail.", "SEND_FAILED", 500);
  }
});
