// Envio de e-mail partilhado pelas funções edge.
//
// Importar com caminho relativo: `import { sendEmail } from "../_shared/email.ts";`
// A CLI do Supabase inclui a pasta _shared no bundle de cada função.
//
// sendEmail nunca lança excepção: devolve { ok, status, error } e regista cada
// tentativa em public.email_log (quando recebe um cliente com service role).
// Sem SMTP_HOST/SMTP_USER/SMTP_PASS o envio fica 'skipped' com o erro
// SMTP_CONFIG_MISSING e é registado como tal, em vez de falhar em silêncio.

import nodemailer from "npm:nodemailer@6.9.11";
import { DEFAULT_EMAIL_FOOTER, type EmailLanguage, htmlLang, type Localized, pick } from "./i18n.ts";
import { siteUrl } from "./account-url.ts";

/** Cliente Supabase mínimo de que este módulo precisa (evita fixar a versão do SDK). */
// deno-lint-ignore no-explicit-any
export type DbClient = { from: (table: string) => any };

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export const SMTP_CONFIG_MISSING = "SMTP_CONFIG_MISSING";
const DEFAULT_ADMIN_EMAIL = "info@ispcfacil.com";

export function getSmtpConfig(): SmtpConfig | null {
  const host = Deno.env.get("SMTP_HOST")?.trim();
  const user = Deno.env.get("SMTP_USER")?.trim();
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass) return null;
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465") || 465;
  const from = Deno.env.get("SMTP_FROM_EMAIL")?.trim() || user;
  return { host, port, user, pass, from };
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim());
}

/** Normaliza, valida e remove duplicados (sem distinguir maiúsculas). */
export function uniqueEmails(list: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (!raw) continue;
    for (const part of String(raw).split(/[,;]/)) {
      const email = part.trim();
      if (!isEmail(email)) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

/** ADMIN_NOTIFICATION_EMAIL aceita vários endereços separados por vírgula. */
export function adminRecipients(): string[] {
  const list = uniqueEmails([Deno.env.get("ADMIN_NOTIFICATION_EMAIL")]);
  return list.length ? list : [DEFAULT_ADMIN_EMAIL];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Cores da marca ISPC Fácil (iguais às do tailwind.config.js). */
export const BRAND = {
  orange: "#f16c39",
  dark: "#332d2a",
  text: "#1f2937",
  muted: "#6b7280",
  border: "#ece7e4",
  background: "#f6f3f1",
  soft: "#fff4ef",
} as const;

const BRAND_TEXT = {
  tagline: {
    "pt-MZ": "O ISPC na palma da sua mão!",
    "en-GB": "ISPC in the palm of your hand!",
    "fr-FR": "L'ISPC dans la paume de votre main !",
  } as Localized,
  terms: { "pt-MZ": "Termos e Condições", "en-GB": "Terms and Conditions", "fr-FR": "Conditions générales" } as Localized,
  privacy: { "pt-MZ": "Política de Privacidade", "en-GB": "Privacy Policy", "fr-FR": "Politique de confidentialité" } as Localized,
  support: { "pt-MZ": "Apoio ao cliente", "en-GB": "Customer support", "fr-FR": "Assistance client" } as Localized,
  legal: {
    "pt-MZ": "ISPC Fácil — software de facturação para Moçambique, desenvolvido pela Law Technology Solutions (LTS).",
    "en-GB": "ISPC Fácil — invoicing software for Mozambique, developed by Law Technology Solutions (LTS).",
    "fr-FR": "ISPC Fácil — logiciel de facturation pour le Mozambique, développé par Law Technology Solutions (LTS).",
  } as Localized,
};

/** Endereço de apoio mostrado no rodapé (SUPPORT_EMAIL, ou o e-mail da LTS). */
function supportEmail(): string {
  const configured = Deno.env.get("SUPPORT_EMAIL")?.trim();
  return configured && isEmail(configured) ? configured : DEFAULT_ADMIN_EMAIL;
}

/**
 * Moldura visual comum com a identidade ISPC Fácil: logótipo, cores da marca e
 * rodapé com os Termos e Condições, a Política de Privacidade e o contacto.
 * `innerHtml` já deve vir escapado. `footer` substitui a nota automática
 * ("não responda…"); os links legais aparecem sempre.
 */
export function emailLayout(
  title: string,
  innerHtml: string,
  footer?: string,
  language: EmailLanguage = "pt-MZ",
): string {
  const site = siteUrl();
  const logoUrl = `${site}/assets/ispc-facil-logo-wide.png`;
  // Os textos legais abrem na página inicial (ver LandingComponent: ?doc=).
  const termsUrl = `${site}/#/?doc=termos`;
  const privacyUrl = `${site}/#/?doc=privacidade`;
  const support = supportEmail();
  const year = new Date().getFullYear();
  const link = `color:${BRAND.orange};text-decoration:none;font-weight:600;`;

  return `<!DOCTYPE html>
<html lang="${htmlLang(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.background};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;font-family:'Poppins',Segoe UI,Helvetica,Arial,sans-serif;color:${BRAND.text};">
        <tr>
          <td style="height:6px;line-height:6px;font-size:0;background:${BRAND.orange};">&nbsp;</td>
        </tr>
        <tr>
          <td align="left" style="padding:22px 28px 14px 28px;">
            <a href="${escapeHtml(site)}" style="text-decoration:none;">
              <img src="${escapeHtml(logoUrl)}" width="150" alt="ISPC Fácil" style="display:block;border:0;outline:none;width:150px;max-width:150px;height:auto;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px;">
            <h1 style="margin:0;padding:0 0 12px 0;font-size:20px;line-height:1.35;font-weight:700;color:${BRAND.dark};border-bottom:2px solid ${BRAND.orange};">${escapeHtml(title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 8px 28px;font-size:14px;line-height:1.6;color:${BRAND.text};">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 24px 28px;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">${footer ?? pick(DEFAULT_EMAIL_FOOTER, language)}</p>
          </td>
        </tr>
        <tr>
          <td style="background:${BRAND.dark};padding:20px 28px;font-size:12px;line-height:1.6;color:#d6d0cc;">
            <p style="margin:0 0 6px 0;font-weight:700;color:#ffffff;">ISPC Fácil <span style="font-weight:400;color:${BRAND.orange};">· ${escapeHtml(pick(BRAND_TEXT.tagline, language))}</span></p>
            <p style="margin:0 0 10px 0;">${escapeHtml(pick(BRAND_TEXT.legal, language))}</p>
            <p style="margin:0 0 10px 0;">
              <a href="${escapeHtml(termsUrl)}" style="${link}">${escapeHtml(pick(BRAND_TEXT.terms, language))}</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(privacyUrl)}" style="${link}">${escapeHtml(pick(BRAND_TEXT.privacy, language))}</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(site)}" style="${link}">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a>
            </p>
            <p style="margin:0;">${escapeHtml(pick(BRAND_TEXT.support, language))}: <a href="mailto:${escapeHtml(support)}" style="${link}">${escapeHtml(support)}</a></p>
            <p style="margin:10px 0 0 0;color:#a39b96;">© ${year} Law Technology Solutions</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Tabela de duas colunas (rótulo / valor). Os valores são escapados aqui. */
export function detailsTable(rows: Array<[string, unknown]>): string {
  const tr = rows
    .map(([label, value], i) =>
      `<tr style="background:${i % 2 ? "#ffffff" : BRAND.soft};">` +
      `<td style="padding:9px 12px;border-bottom:1px solid ${BRAND.border};font-weight:600;color:${BRAND.dark};width:170px;vertical-align:top;font-size:13px;">${escapeHtml(label)}</td>` +
      `<td style="padding:9px 12px;border-bottom:1px solid ${BRAND.border};font-size:13px;">${escapeHtml(value === null || value === undefined || value === "" ? "—" : value)}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid ${BRAND.border};border-radius:8px;">${tr}</table>`;
}

/** Caixa de destaque (ex.: "factura em anexo"). `innerHtml` já deve vir escapado. */
export function noticeBox(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">` +
    `<tr><td style="background:${BRAND.soft};border-left:4px solid ${BRAND.orange};padding:12px 14px;font-size:13px;line-height:1.5;color:${BRAND.dark};border-radius:4px;">${innerHtml}</td></tr></table>`;
}

export function buildTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
}

export interface SendEmailOptions {
  /** Ex.: 'subscription_activated_client', 'subscription_activated_admin', 'signup_admin'. */
  kind: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  /** Nome visível do remetente. O endereço é sempre o da plataforma. */
  fromName?: string;
  // deno-lint-ignore no-explicit-any
  attachments?: any[];
  companyId?: string | null;
  relatedTable?: string | null;
  relatedId?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  messageId?: string;
  error?: string;
  recipients: string[];
}

function toList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return uniqueEmails(Array.isArray(v) ? v : [v]);
}

async function writeLog(
  db: DbClient | null,
  opts: SendEmailOptions,
  recipients: string[],
  result: SendEmailResult,
) {
  if (!db) return;
  try {
    const { error } = await db.from("email_log").insert({
      kind: opts.kind,
      company_id: opts.companyId ?? null,
      related_table: opts.relatedTable ?? null,
      related_id: opts.relatedId ?? null,
      recipients,
      subject: opts.subject,
      status: result.status,
      error: result.error ?? null,
      message_id: result.messageId ?? null,
    });
    if (error) console.warn(`[email] email_log insert failed: ${error.message ?? error}`);
  } catch (e) {
    console.warn("[email] email_log insert threw:", e);
  }
}

/**
 * Envia um e-mail e regista o resultado em email_log. Nunca lança excepção.
 * Passe `db` = cliente com service role para registar; `null` para não registar.
 */
export async function sendEmail(db: DbClient | null, opts: SendEmailOptions): Promise<SendEmailResult> {
  const to = toList(opts.to);
  const cc = toList(opts.cc);
  const bcc = toList(opts.bcc);
  const recipients = uniqueEmails([...to, ...cc, ...bcc]);
  const label = `[email] kind=${opts.kind} to=${recipients.join(",") || "(none)"}`;

  let result: SendEmailResult;

  if (!to.length) {
    result = { ok: false, status: "skipped", error: "NO_RECIPIENTS", recipients };
    console.warn(`${label} skipped: no valid recipients`);
    await writeLog(db, opts, recipients, result);
    return result;
  }

  const config = getSmtpConfig();
  if (!config) {
    result = { ok: false, status: "skipped", error: SMTP_CONFIG_MISSING, recipients };
    console.warn(`${label} skipped: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)`);
    await writeLog(db, opts, recipients, result);
    return result;
  }

  try {
    const transporter = buildTransport(config);
    const fromName = sanitizeHeader(opts.fromName || "ISPC Fácil").replace(/"/g, "'");
    const info = await transporter.sendMail({
      from: `"${fromName}" <${config.from}>`,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      replyTo: opts.replyTo && isEmail(opts.replyTo) ? opts.replyTo.trim() : undefined,
      subject: sanitizeHeader(opts.subject),
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    result = { ok: true, status: "sent", messageId: info?.messageId, recipients };
    console.log(`${label} ok messageId=${info?.messageId ?? "-"}`);
  } catch (e) {
    const message = (e as Error)?.message || String(e);
    result = { ok: false, status: "failed", error: message, recipients };
    console.error(`${label} err: ${message}`);
  }

  await writeLog(db, opts, recipients, result);
  return result;
}

/** Corre uma tarefa depois de responder, quando o runtime o permite (EdgeRuntime.waitUntil). */
export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((e) => console.error("[background] task failed:", e));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(guarded);
  }
  // Sem EdgeRuntime (ex.: testes locais com deno run) a promessa continua a correr.
}
