import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  escapeHtml,
  getSmtpConfig,
  isEmail,
  sanitizeHeader,
  sendEmail,
  SMTP_CONFIG_MISSING,
} from "../_shared/email.ts";
import {
  type CompanyNotificationSettings,
  getCompaniesNotificationSettings,
  getCompanyNotificationSettings,
  withNotificationEmail,
} from "../_shared/notification-recipients.ts";

/**
 * Lembretes de obrigações fiscais (Modelo 30 / ISPC) por email.
 *
 * Autenticação:
 *  - agendador (pg_cron + pg_net, ou externo): cabeçalho `x-cron-secret`;
 *  - administrador da plataforma (Back Office): JWT com profiles.role = 'admin';
 *  - dono da empresa: JWT, só no modo 'test' e só para si próprio.
 *
 * Modos (`mode`):
 *  - 'run' (por omissão): gera os lembretes de HOJE com generate_tax_reminders,
 *    envia os que estão na fila (emailed_at e cancelled_at nulos), uma mensagem
 *    por empresa, para o dono da conta, o email da empresa e o "Email para
 *    Notificações" (Configurações > Sistema), e marca
 *    emailed_at/email_error. Ignora `reference_date`: datas simuladas nunca
 *    ficam registadas nem chegam a clientes.
 *  - 'preview': não escreve nada. Mostra o que o motor emitiria numa data
 *    (`reference_date`, por omissão hoje) via compute_tax_reminders, a fila
 *    actual, os destinatários reais e se o SMTP está configurado.
 *  - 'test': não escreve nada em tax_reminders/ai_alerts. Envia uma mensagem
 *    "[TESTE]" com os lembretes da data simulada SÓ para `to` (nunca para o
 *    cliente). Com `sample` (por omissão true), se nada estiver previsto nessa
 *    data envia um lembrete de exemplo, para se poder verificar o SMTP.
 *
 * Compatibilidade: `dry_run: true` equivale a `mode: 'preview'`.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Tecto por execução, para não exceder o tempo limite da função. */
const MAX_REMINDERS_PER_RUN = 500;
/** Tecto de linhas devolvidas no modo 'preview'. */
const MAX_PREVIEW_ROWS = 200;
/** Envios de teste por empresa (dono) em cada janela de 10 minutos. */
const OWNER_TEST_LIMIT = 3;
/**
 * Prazos anteriores a esta data (backlog até ao 2.º trimestre de 2026) nunca
 * seguem por email; ficam só visíveis na aplicação. Igual a c_email_cutoff em
 * generate_tax_reminders (migração 20261009130000).
 */
const EMAIL_CUTOFF = "2026-10-01";

type Mode = "run" | "preview" | "test";
type Kind = "qend" | "d15" | "d7" | "d1" | "d0" | "overdue";

interface RequestBody {
  mode?: Mode;
  reference_date?: string;
  company_id?: string;
  to?: string;
  sample?: boolean;
  dry_run?: boolean;
  skip_generate?: boolean;
}

interface ReminderContent {
  company_id: string;
  year: number;
  quarter: number;
  kind: Kind;
  due_date: string;
  title: string;
  body: string;
}

interface Reminder extends ReminderContent {
  id: string;
  created_at: string;
}

interface ComputedReminder extends ReminderContent {
  days_left: number;
  severity: string;
  already_issued: boolean;
}

interface Company {
  id: string;
  name: string;
  email: string | null;
  user_id: string;
  nuit: string | null;
  status: string | null;
}

type Caller =
  | { kind: "cron" }
  | { kind: "admin"; userId: string; email: string | null }
  | { kind: "user"; userId: string; email: string | null };

// deno-lint-ignore no-explicit-any
type Admin = any;

class HttpError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const KIND_STYLE: Record<Kind, { label: string; color: string; bg: string }> = {
  qend: { label: "Fim do trimestre", color: "#1d4ed8", bg: "#eff6ff" },
  d15: { label: "Lembrete", color: "#1d4ed8", bg: "#eff6ff" },
  d7: { label: "Aviso", color: "#c2410c", bg: "#fff7ed" },
  d1: { label: "Urgente", color: "#b91c1c", bg: "#fef2f2" },
  d0: { label: "Último dia", color: "#b91c1c", bg: "#fef2f2" },
  overdue: { label: "Incumprimento", color: "#991b1b", bg: "#fee2e2" },
};

/** Mais urgentes primeiro. */
const KIND_ORDER: Record<Kind, number> = { overdue: 0, d0: 1, d1: 2, d7: 3, d15: 4, qend: 5 };

function sortByUrgency<T extends { kind: Kind }>(list: T[]): T[] {
  return [...list].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function buildSubject(company: Company, reminders: ReminderContent[]): string {
  const overdue = reminders.some((r) => r.kind === "overdue");
  const base = overdue
    ? "Incumprimento fiscal: Modelo 30 em atraso"
    : reminders.length === 1
    ? reminders[0].title
    : "Lembrete: prazo do Modelo 30 (ISPC)";
  return sanitizeHeader(`${base} — ${company.name}`);
}

function buildHtml(
  company: Company,
  reminders: ReminderContent[],
  appUrl: string,
  banner?: string,
): string {
  const items = reminders
    .map((r) => {
      const s = KIND_STYLE[r.kind];
      return `
        <tr><td style="padding:0 0 14px 0;">
          <div style="border-left:4px solid ${s.color};background:${s.bg};border-radius:6px;padding:14px 16px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${s.color};margin-bottom:4px;">${escapeHtml(s.label)}</div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">${escapeHtml(r.title)}</div>
            <div style="font-size:14px;line-height:1.55;color:#374151;">${escapeHtml(r.body)}</div>
          </div>
        </td></tr>`;
    })
    .join("");

  const link = `${appUrl.replace(/\/$/, "")}/impostos`;
  const bannerHtml = banner
    ? `<div style="margin:0 0 16px 0;padding:10px 14px;border:1px dashed #d97706;background:#fffbeb;border-radius:6px;font-size:13px;color:#92400e;">${escapeHtml(banner)}</div>`
    : "";

  return `<!doctype html>
<html lang="pt">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td style="background:#1e3a8a;padding:18px 24px;color:#ffffff;">
          <div style="font-size:18px;font-weight:700;">ISPC Fácil</div>
          <div style="font-size:13px;opacity:.85;">Obrigações fiscais</div>
        </td></tr>
        <tr><td style="padding:24px;">
          ${bannerHtml}
          <p style="margin:0 0 16px 0;font-size:14px;color:#111827;">
            Caro contribuinte <strong>${escapeHtml(company.name)}</strong>${company.nuit ? ` (NUIT ${escapeHtml(company.nuit)})` : ""},
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
          <p style="margin:8px 0 20px 0;">
            <a href="${escapeHtml(link)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">Abrir Gestão de Impostos</a>
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
            Se já entregou a declaração ou pagou o imposto, registe-o na área de impostos para deixar de receber estes avisos.
            Esta mensagem é informativa e não substitui o aconselhamento de um técnico de contas.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(
  company: Company,
  reminders: ReminderContent[],
  appUrl: string,
  banner?: string,
): string {
  return [
    ...(banner ? [banner, ""] : []),
    `Caro contribuinte ${company.name},`,
    "",
    ...reminders.map((r) => `${r.title}\n${r.body}\n`),
    `Gestão de Impostos: ${appUrl.replace(/\/$/, "")}/impostos`,
  ].join("\n");
}

/** Marco que corresponde a `daysLeft` dias até ao prazo (regras de compute_tax_reminders). */
function kindForDays(daysLeft: number): Kind {
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "d0";
  if (daysLeft === 1) return "d1";
  if (daysLeft <= 7) return "d7";
  if (daysLeft <= 15) return "d15";
  return "qend";
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function todayUtc(): string {
  // CURRENT_DATE da base de dados (UTC); o cron corre às 06:00 UTC = 08:00 Maputo.
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authenticate(req: Request, admin: Admin): Promise<Caller> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret) {
    if (cronSecret && headerSecret === cronSecret) return { kind: "cron" };
    throw new HttpError(401, "Não autorizado.", "UNAUTHORIZED");
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new HttpError(401, "Não autorizado.", "UNAUTHORIZED");

  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user) {
    throw new HttpError(401, "Sessão inválida. Entre novamente no sistema.", "UNAUTHENTICATED");
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const email = isEmail(user.email) ? user.email.trim() : null;
  return profile?.role === "admin"
    ? { kind: "admin", userId: user.id, email }
    : { kind: "user", userId: user.id, email };
}

async function loadCompany(admin: Admin, companyId: string): Promise<Company> {
  const { data, error } = await admin
    .from("companies")
    .select("id, name, email, user_id, nuit, status")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, "DB_ERROR");
  if (!data) throw new HttpError(404, "Empresa não encontrada.", "COMPANY_NOT_FOUND");
  return data as Company;
}

/**
 * Destinatários reais: email do dono da conta, email da empresa e o "Email
 * para Notificações" de Configurações > Sistema (acrescentado, sem duplicados).
 */
async function realRecipients(
  admin: Admin,
  company: Company,
  settings?: CompanyNotificationSettings,
): Promise<string[]> {
  const prefs = settings ?? await getCompanyNotificationSettings(admin, company.id);
  let ownerEmail: string | null = null;
  const { data: owner, error } = await admin.auth.admin.getUserById(company.user_id);
  if (error) {
    console.warn(`send-tax-reminders: dono da empresa ${company.id} não encontrado: ${error.message}`);
  } else {
    ownerEmail = owner?.user?.email ?? null;
  }
  return withNotificationEmail([ownerEmail, company.email], prefs).map((e) => e.toLowerCase());
}

async function computeReminders(
  admin: Admin,
  referenceDate: string,
  companyId: string | null,
): Promise<ComputedReminder[]> {
  const { data, error } = await admin.rpc("compute_tax_reminders", {
    p_reference_date: referenceDate,
    p_company_id: companyId,
  });
  if (error) throw new HttpError(500, error.message, "DB_ERROR");
  return (data ?? []) as ComputedReminder[];
}

/** Lembrete de exemplo (d15) do trimestre acabado de fechar na data simulada. */
async function sampleReminder(
  admin: Admin,
  companyId: string,
  referenceDate: string,
): Promise<ReminderContent> {
  const ref = new Date(`${referenceDate}T00:00:00Z`);
  let year = ref.getUTCFullYear();
  let quarter = Math.floor(ref.getUTCMonth() / 3); // trimestre anterior (0 = 4.º do ano anterior)
  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }
  // Último dia do mês seguinte ao fim do trimestre.
  const due = new Date(Date.UTC(year, quarter * 3 + 1, 0)).toISOString().slice(0, 10);

  const { data, error } = await admin.rpc("tax_reminder_text", {
    p_kind: "d15",
    p_year: year,
    p_quarter: quarter,
    p_due: due,
    p_days: 15,
  });
  if (error) throw new HttpError(500, error.message, "DB_ERROR");
  const text = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    company_id: companyId,
    year,
    quarter,
    kind: "d15",
    due_date: due,
    title: String(text.title ?? `Modelo 30 (${quarter}º trimestre de ${year})`),
    body: String(text.body ?? ""),
  };
}

const SMTP_MISSING_MESSAGE =
  "Servidor de email não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS). Configure os segredos da Edge Function no Supabase.";

// ---------------------------------------------------------------------------
// Modo 'preview'
// ---------------------------------------------------------------------------

async function handlePreview(admin: Admin, body: RequestBody) {
  const referenceDate = body.reference_date ?? todayUtc();
  const companyId = body.company_id ?? null;
  const smtp = getSmtpConfig();

  const computed = await computeReminders(admin, referenceDate, companyId);

  let queuedQuery = admin
    .from("tax_reminders")
    .select("id, company_id, year, quarter, kind, due_date, title, created_at, email_error")
    .is("emailed_at", null)
    .is("cancelled_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PREVIEW_ROWS);
  if (companyId) queuedQuery = queuedQuery.eq("company_id", companyId);
  const { data: queued, error: queuedError } = await queuedQuery;
  if (queuedError) throw new HttpError(500, queuedError.message, "DB_ERROR");

  let company: Company | null = null;
  let recipients: string[] = [];
  let notificationsEnabled: boolean | null = null;
  let history: unknown[] = [];
  if (companyId) {
    company = await loadCompany(admin, companyId);
    const prefs = await getCompanyNotificationSettings(admin, companyId);
    notificationsEnabled = prefs.enableNotifications;
    recipients = await realRecipients(admin, company, prefs);
    const { data: hist } = await admin
      .from("tax_reminders")
      .select("id, year, quarter, kind, due_date, title, created_at, emailed_at, cancelled_at, email_error")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(10);
    history = hist ?? [];
  }

  return {
    ok: true,
    mode: "preview",
    reference_date: referenceDate,
    smtp_configured: smtp !== null,
    from: smtp?.from ?? null,
    company: company ? { id: company.id, name: company.name, status: company.status } : null,
    recipients,
    // false: "Habilitar Notificações" desligado — o modo 'run' não envia lembretes a esta empresa.
    notifications_enabled: notificationsEnabled,
    would_generate: computed.filter((r) => !r.already_issued).length,
    reminders: sortByUrgency(computed).slice(0, MAX_PREVIEW_ROWS),
    truncated: computed.length > MAX_PREVIEW_ROWS,
    queued: queued ?? [],
    history,
  };
}

// ---------------------------------------------------------------------------
// Modo 'test'
// ---------------------------------------------------------------------------

async function handleTest(admin: Admin, caller: Caller, body: RequestBody) {
  if (!body.company_id) {
    throw new HttpError(400, "Indique a empresa (company_id).", "COMPANY_REQUIRED");
  }
  const company = await loadCompany(admin, body.company_id);

  let referenceDate = body.reference_date ?? todayUtc();
  let to: string | null;

  if (caller.kind === "user") {
    // Dono da empresa: só a sua empresa, só hoje, só para o seu próprio email.
    if (company.user_id !== caller.userId) {
      throw new HttpError(403, "Apenas o proprietário da empresa pode pedir um lembrete de teste.", "FORBIDDEN");
    }
    referenceDate = todayUtc();
    to = caller.email;

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("kind", "tax_reminder_test")
      .eq("company_id", company.id)
      .gte("created_at", since);
    if ((count ?? 0) >= OWNER_TEST_LIMIT) {
      throw new HttpError(429, "Já pediu vários lembretes de teste. Aguarde alguns minutos e tente de novo.", "RATE_LIMITED");
    }
  } else if (caller.kind === "admin") {
    to = body.to ? body.to.trim() : caller.email;
  } else {
    to = body.to ? body.to.trim() : null;
  }

  if (!isEmail(to)) {
    throw new HttpError(400, "Indique um endereço de email válido para o teste (to).", "INVALID_EMAIL");
  }

  const computed = sortByUrgency(await computeReminders(admin, referenceDate, company.id));
  // O email de teste reproduz o que o modo 'run' enviaria nessa data: só os
  // marcos ainda não emitidos e nunca o backlog anterior ao corte. Os restantes
  // aparecem apenas na resposta JSON (`not_emailed`).
  const isSendable = (r: ComputedReminder) => !r.already_issued && r.due_date >= EMAIL_CUTOFF;
  const notEmailed = computed
    .filter((r) => !isSendable(r))
    .map((r) => ({
      ...r,
      reason: r.due_date < EMAIL_CUTOFF ? "backlog_anterior_ao_corte" : "ja_emitido",
    }));
  let reminders: ReminderContent[] = computed.filter(isSendable);
  let sampleUsed = false;
  if (reminders.length === 0 && body.sample !== false) {
    reminders = [await sampleReminder(admin, company.id, referenceDate)];
    sampleUsed = true;
  }

  const recipients = await realRecipients(admin, company);
  const smtp = getSmtpConfig();
  const base = {
    mode: "test",
    reference_date: referenceDate,
    to,
    smtp_configured: smtp !== null,
    from: smtp?.from ?? null,
    sample_used: sampleUsed,
    real_recipients: recipients,
    reminders,
    not_emailed: notEmailed,
  };

  if (reminders.length === 0) {
    return {
      ...base,
      ok: false,
      code: "NOTHING_TO_SEND",
      message: `Nenhum lembrete por enviar em ${referenceDate}. Active "sample" para enviar um exemplo.`,
    };
  }

  if (!smtp) {
    return { ...base, ok: false, code: SMTP_CONFIG_MISSING, message: SMTP_MISSING_MESSAGE };
  }

  const banner = [
    `Mensagem de teste — data simulada ${referenceDate}.`,
    sampleUsed ? "Nenhum lembrete por enviar nessa data; segue um lembrete de exemplo." : "",
    `Destinatários reais: ${recipients.length ? recipients.join(", ") : "nenhum email configurado"}.`,
    "Nada foi registado nem enviado ao cliente.",
  ].filter(Boolean).join(" ");

  const appUrl = Deno.env.get("SITE_URL") ?? "https://ispcfacil.co.mz";
  const result = await sendEmail(admin, {
    kind: "tax_reminder_test",
    to,
    subject: `[TESTE] ${buildSubject(company, reminders)}`,
    html: buildHtml(company, reminders, appUrl, banner),
    text: buildText(company, reminders, appUrl, banner),
    companyId: company.id,
    relatedTable: "companies",
    relatedId: company.id,
  });

  if (!result.ok) {
    return {
      ...base,
      ok: false,
      code: result.error === SMTP_CONFIG_MISSING ? SMTP_CONFIG_MISSING : "SEND_FAILED",
      message: result.error === SMTP_CONFIG_MISSING
        ? SMTP_MISSING_MESSAGE
        : `O servidor de email recusou o envio: ${result.error ?? "erro desconhecido"}`,
    };
  }

  return {
    ...base,
    ok: true,
    message_id: result.messageId ?? null,
    message: `Lembrete de teste enviado para ${to}.`,
  };
}

// ---------------------------------------------------------------------------
// Modo 'run' (agendador)
// ---------------------------------------------------------------------------

async function cancelReminders(admin: Admin, ids: string[], reason: string) {
  if (!ids.length) return;
  await admin
    .from("tax_reminders")
    .update({ cancelled_at: new Date().toISOString(), email_error: reason })
    .in("id", ids)
    .is("emailed_at", null);
}

async function handleRun(admin: Admin, body: RequestBody) {
  const companyId = body.company_id ?? null;
  const smtp = getSmtpConfig();

  // --- 1. Gerar (sempre com a data de hoje) ------------------------------------
  let generated: number | null = null;
  if (!body.skip_generate) {
    const args: Record<string, string> = {};
    if (companyId) args.p_company_id = companyId;
    const { data, error } = await admin.rpc("generate_tax_reminders", args);
    if (error) {
      console.error("send-tax-reminders (gerar):", error.message);
      throw new HttpError(500, error.message, "DB_ERROR");
    }
    generated = data as number;
  }

  // --- 2. Fila ----------------------------------------------------------------
  let query = admin
    .from("tax_reminders")
    .select("id, company_id, year, quarter, kind, due_date, title, body, created_at")
    .is("emailed_at", null)
    .is("cancelled_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_REMINDERS_PER_RUN);
  if (companyId) query = query.eq("company_id", companyId);

  const { data: pending, error: pendingError } = await query;
  if (pendingError) throw new HttpError(500, pendingError.message, "DB_ERROR");

  let reminders = (pending ?? []) as Reminder[];
  let cancelled = 0;
  const today = todayUtc();

  // Backlog anterior ao corte: nunca segue por email (o motor já o insere
  // cancelado; isto apanha linhas antigas que tenham escapado).
  const backlog = reminders.filter((r) => r.due_date < EMAIL_CUTOFF);
  await cancelReminders(admin, backlog.map((r) => r.id), "Backlog inicial não enviado");
  cancelled += backlog.length;
  reminders = reminders.filter((r) => r.due_date >= EMAIL_CUTOFF);

  // Lembretes desactualizados: o texto foi fixado quando a linha foi gerada.
  // Se entretanto se atingiu um marco mais urgente (ex.: 'd7' na fila e hoje
  // falta 1 dia, ou 'd0' depois do prazo), a linha é cancelada — o motor gera
  // o marco actual. Se o marco é o mesmo ('d15'/'d7' com menos dias), o texto
  // é refeito com os dias que realmente faltam.
  const stale: Reminder[] = [];
  const fresh: Reminder[] = [];
  for (const r of reminders) {
    if (r.kind === "overdue") {
      fresh.push(r);
      continue;
    }
    const daysLeft = daysBetween(today, r.due_date);
    const current = kindForDays(daysLeft);
    if (current !== r.kind) {
      stale.push(r);
      continue;
    }
    if (r.kind === "d15" || r.kind === "d7") {
      const { data, error } = await admin.rpc("tax_reminder_text", {
        p_kind: r.kind,
        p_year: r.year,
        p_quarter: r.quarter,
        p_due: r.due_date,
        p_days: daysLeft,
      });
      const text = Array.isArray(data) ? data[0] : data;
      if (!error && text?.title && text?.body && (text.title !== r.title || text.body !== r.body)) {
        r.title = String(text.title);
        r.body = String(text.body);
        await admin
          .from("tax_reminders")
          .update({ title: r.title, body: r.body })
          .eq("id", r.id)
          .is("emailed_at", null);
      }
    }
    fresh.push(r);
  }
  await cancelReminders(admin, stale.map((r) => r.id), "Desactualizado: marco ultrapassado");
  cancelled += stale.length;
  reminders = fresh;

  // Trimestres entretanto regularizados (importante com skip_generate).
  if (reminders.length) {
    const companyIds = [...new Set(reminders.map((r) => r.company_id))];
    const { data: decls } = await admin
      .from("tax_declarations")
      .select("company_id, year, period")
      .in("company_id", companyIds)
      .in("status", ["submetida", "paga"]);
    const done = new Set(
      ((decls ?? []) as Array<{ company_id: string; year: number; period: number }>)
        .map((d) => `${d.company_id}:${d.year}:${d.period}`),
    );
    const compliant = reminders.filter((r) => done.has(`${r.company_id}:${r.year}:${r.quarter}`));
    await cancelReminders(admin, compliant.map((r) => r.id), "Cancelado: declaração submetida/paga");
    cancelled += compliant.length;
    reminders = reminders.filter((r) => !done.has(`${r.company_id}:${r.year}:${r.quarter}`));
  }

  // Do mesmo trimestre só segue o lembrete mais urgente (ex.: se o envio
  // falhou vários dias, não se manda "faltam 7 dias" junto com "falta 1 dia").
  const bestByQuarter = new Map<string, Reminder>();
  for (const r of reminders) {
    const key = `${r.company_id}:${r.year}:${r.quarter}`;
    const current = bestByQuarter.get(key);
    if (!current || KIND_ORDER[r.kind] < KIND_ORDER[current.kind]) bestByQuarter.set(key, r);
  }
  const superseded = reminders.filter(
    (r) => bestByQuarter.get(`${r.company_id}:${r.year}:${r.quarter}`)!.id !== r.id,
  );
  await cancelReminders(admin, superseded.map((r) => r.id), "Substituído por lembrete mais recente");
  cancelled += superseded.length;
  reminders = [...bestByQuarter.values()];

  const byCompany = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const list = byCompany.get(r.company_id) ?? [];
    list.push(r);
    byCompany.set(r.company_id, list);
  }

  const summary = {
    ok: true,
    mode: "run",
    generated,
    reference_date: today,
    reference_date_ignored: Boolean(body.reference_date),
    smtp_configured: smtp !== null,
    pending: reminders.length,
    cancelled,
    companies: byCompany.size,
    emails_sent: 0,
    reminders_emailed: 0,
    failures: 0,
    details: [] as Array<{
      company_id: string;
      company_name?: string;
      recipients: string[];
      reminders: Array<{ kind: string; year: number; quarter: number; title: string }>;
      status: "enviado" | "cancelado" | "erro";
      error?: string;
    }>,
  };

  if (byCompany.size === 0) return { status: 200, payload: summary };

  if (!smtp) {
    // Sem SMTP não se marca nada: os lembretes ficam na fila para a próxima
    // execução, quando a configuração estiver corrigida.
    return {
      status: 500,
      payload: { ...summary, ok: false, code: SMTP_CONFIG_MISSING, error: SMTP_MISSING_MESSAGE },
    };
  }

  const { data: companiesData, error: companiesError } = await admin
    .from("companies")
    .select("id, name, email, user_id, nuit, status")
    .in("id", [...byCompany.keys()]);
  if (companiesError) throw new HttpError(500, companiesError.message, "DB_ERROR");
  const companies = new Map(((companiesData ?? []) as Company[]).map((c) => [c.id, c]));
  const notificationSettings = await getCompaniesNotificationSettings(admin, [...byCompany.keys()]);

  const appUrl = Deno.env.get("SITE_URL") ?? "https://ispcfacil.co.mz";

  // --- 3. Enviar --------------------------------------------------------------
  for (const [cid, unsorted] of byCompany) {
    const list = sortByUrgency(unsorted);
    const company = companies.get(cid);
    const ids = list.map((r) => r.id);
    const detail: (typeof summary.details)[number] = {
      company_id: cid,
      company_name: company?.name,
      recipients: [],
      reminders: list.map((r) => ({ kind: r.kind, year: r.year, quarter: r.quarter, title: r.title })),
      status: "erro",
    };

    try {
      if (!company) throw new Error("Empresa não encontrada.");

      if (company.status === "suspended") {
        await cancelReminders(admin, ids, "Empresa suspensa");
        detail.status = "cancelado";
        summary.cancelled += ids.length;
        summary.details.push(detail);
        continue;
      }

      // "Habilitar Notificações" desligado em Configurações > Sistema: não se
      // envia o email (o lembrete continua visível na aplicação) e marca-se
      // como cancelado para não voltar à fila em todas as execuções.
      const prefs = notificationSettings.get(cid);
      if (prefs && !prefs.enableNotifications) {
        await cancelReminders(admin, ids, "desactivado");
        detail.status = "cancelado";
        detail.error = "Notificações desactivadas nas Configurações do Sistema";
        summary.cancelled += ids.length;
        summary.details.push(detail);
        continue;
      }

      const recipients = await realRecipients(admin, company, prefs);
      detail.recipients = recipients;
      if (recipients.length === 0) throw new Error("Sem endereço de email para a empresa.");

      const result = await sendEmail(admin, {
        kind: "tax_reminder",
        to: recipients,
        subject: buildSubject(company, list),
        html: buildHtml(company, list, appUrl),
        text: buildText(company, list, appUrl),
        companyId: company.id,
        relatedTable: "tax_reminders",
        relatedId: ids[0],
      });
      if (!result.ok) throw new Error(result.error ?? "Falha no envio.");

      await admin
        .from("tax_reminders")
        .update({ emailed_at: new Date().toISOString(), email_error: null })
        .in("id", ids);

      detail.status = "enviado";
      summary.emails_sent += 1;
      summary.reminders_emailed += ids.length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      detail.status = "erro";
      detail.error = message;
      summary.failures += 1;
      console.error(`send-tax-reminders (${cid}):`, message);

      // Fica registado o erro; emailed_at continua nulo e o envio é
      // novamente tentado na próxima execução.
      await admin
        .from("tax_reminders")
        .update({ email_error: message.slice(0, 500) })
        .in("id", ids);
    }

    summary.details.push(detail);
  }

  return { status: 200, payload: summary };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const caller = await authenticate(req, admin);

    let body: RequestBody = {};
    try {
      const raw = await req.text();
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "Pedido inválido.", "BAD_REQUEST");
    }

    const mode: Mode = body.mode ?? (body.dry_run === true ? "preview" : "run");
    if (!["run", "preview", "test"].includes(mode)) {
      throw new HttpError(400, "mode deve ser 'run', 'preview' ou 'test'.", "BAD_REQUEST");
    }
    if (body.reference_date && !isValidDate(body.reference_date)) {
      throw new HttpError(400, "reference_date deve ser uma data válida no formato AAAA-MM-DD.", "BAD_REQUEST");
    }
    if (body.company_id && !UUID_RE.test(body.company_id)) {
      throw new HttpError(400, "company_id inválido.", "BAD_REQUEST");
    }

    // Donos de empresa só podem pedir um teste para si próprios.
    if (caller.kind === "user" && mode !== "test") {
      throw new HttpError(403, "Apenas administradores da plataforma.", "FORBIDDEN");
    }

    if (mode === "preview") return json(await handlePreview(admin, body));
    if (mode === "test") return json(await handleTest(admin, caller, body));

    const { status, payload } = await handleRun(admin, body);
    return json(payload, status);
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ ok: false, error: e.message, code: e.code }, e.status);
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("send-tax-reminders:", message);
    return json({ ok: false, error: message, code: "INTERNAL" }, 500);
  }
});
