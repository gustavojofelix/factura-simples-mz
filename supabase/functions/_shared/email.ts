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

/** Moldura visual comum (cabeçalho laranja #f16c39). `innerHtml` já deve vir escapado. */
export function emailLayout(title: string, innerHtml: string, footer?: string): string {
  return `
  <div style="font-family:sans-serif;padding:24px;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:10px;color:#1f2937;">
    <h2 style="color:#f16c39;border-bottom:2px solid #f16c39;padding-bottom:10px;margin-top:0;">${escapeHtml(title)}</h2>
    ${innerHtml}
    <hr style="border:none;border-top:1px solid #eee;margin-top:24px;"/>
    <p style="font-size:11px;color:#888;">${footer ?? "E-mail automático do ISPC Fácil. Não responda a este e-mail."}</p>
  </div>`;
}

/** Tabela de duas colunas (rótulo / valor). Os valores são escapados aqui. */
export function detailsTable(rows: Array<[string, unknown]>): string {
  const tr = rows
    .map(([label, value]) =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;width:170px;vertical-align:top;">${escapeHtml(label)}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(value === null || value === undefined || value === "" ? "—" : value)}</td></tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:20px 0;">${tr}</table>`;
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
