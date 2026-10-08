// Notificações por e-mail dos pagamentos de subscrição.
//
// - notifySubscriptionActivated: dois e-mails separados, um para o cliente
//   (dono da empresa, quem pagou e o e-mail de notificações das Configurações)
//   e outro, interno e mais detalhado, para a LTS (ADMIN_NOTIFICATION_EMAIL).
//   É idempotente: só envia o que ainda não tem client_notified_at /
//   admin_notified_at, a não ser que `force` seja true (reenvio pelo admin).
// - notifySubscriptionPaymentFailed: aviso só para a LTS quando a carteira
//   móvel devolve erro. Não há e-mail no início do pagamento.

import {
  adminRecipients,
  type DbClient,
  detailsTable,
  emailLayout,
  escapeHtml,
  sendEmail,
  type SendEmailResult,
  uniqueEmails,
} from "./email.ts";
import {
  type CompanyNotificationSettings,
  formatCompanyDate,
  getCompanyNotificationSettings,
} from "./notification-recipients.ts";

export type NotifySource = "webhook" | "manual" | "resend";

export interface NotifyOptions {
  source?: NotifySource;
  /** E-mail do administrador que confirmou ou pediu o reenvio. */
  actorEmail?: string | null;
  /** Ignora client_notified_at / admin_notified_at e envia de novo. */
  force?: boolean;
}

export interface NotifyPartResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped" | "already_sent";
  recipients?: string[];
  error?: string;
}

export interface NotifyResult {
  ok: boolean;
  client: NotifyPartResult;
  admin: NotifyPartResult;
  error?: string;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export function cycleLabel(cycle: string | null | undefined): string {
  switch (cycle) {
    case "yearly":
      return "Anual (1 Ano)";
    case "semiannual":
      return "Semestral (6 Meses)";
    case "quarterly":
      return "Trimestral (3 Meses)";
    default:
      return "Mensal (1 Mês)";
  }
}

function methodLabel(method: string | null | undefined): string {
  if (method === "mpesa") return "M-Pesa";
  if (method === "emola") return "e-Mola";
  return method ? String(method).toUpperCase() : "—";
}

function formatAmount(amount: unknown, currency = "MZN"): string {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "MZN" ? `${formatted} MT` : `${formatted} ${currency}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("pt-PT", { timeZone: /T00:00:00Z$/.test(iso) ? "UTC" : "Africa/Maputo" });
}

function formatDateTime(value: string | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-PT", { timeZone: "Africa/Maputo" });
}

async function loadPayment(db: DbClient, paymentId: string): Promise<Row | null> {
  const { data, error } = await db
    .from("subscription_payments")
    .select("*, companies(*)")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) {
    console.error(`[subscription-notify] could not load payment ${paymentId}:`, error);
    return null;
  }
  return data;
}

interface Owner {
  email: string | null;
  fullName: string | null;
}

async function resolveOwner(db: DbClient, payment: Row): Promise<Owner> {
  // (a) Dono pela tabela company_users. O hint é obrigatório: user_id tem duas
  //     FKs para profiles e sem ele o PostgREST devolve PGRST201.
  try {
    const { data, error } = await db
      .from("company_users")
      .select("profiles!company_users_user_id_fkey(email, full_name)")
      .eq("company_id", payment.company_id)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    if (error) console.warn("[subscription-notify] owner lookup via company_users failed:", error);
    const p = data?.profiles;
    const profile = Array.isArray(p) ? p[0] : p;
    if (profile?.email) return { email: profile.email, fullName: profile.full_name ?? null };
  } catch (e) {
    console.warn("[subscription-notify] owner lookup threw:", e);
  }

  // (b) Recurso: companies.user_id -> profiles.
  const ownerId = payment.companies?.user_id;
  if (ownerId) {
    const { data } = await db
      .from("profiles")
      .select("email, full_name")
      .eq("id", ownerId)
      .maybeSingle();
    if (data?.email) return { email: data.email, fullName: data.full_name ?? null };
  }
  return { email: null, fullName: null };
}

/**
 * "Email para Notificações" de Configurações > Sistema. Só recebe a
 * confirmação quando "Habilitar Notificações" está ligado; o dono e quem
 * pagou recebem-na sempre.
 */
function settingsNotificationEmail(settings: CompanyNotificationSettings): string | null {
  return settings.enableNotifications ? settings.notificationEmail : null;
}

async function loadSubscription(db: DbClient, payment: Row): Promise<Row | null> {
  if (payment.subscription_id) {
    const { data } = await db
      .from("subscriptions")
      .select("id, status, plan_name, start_date, end_date, next_billing_date")
      .eq("id", payment.subscription_id)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await db
    .from("subscriptions")
    .select("id, status, plan_name, start_date, end_date, next_billing_date")
    .eq("company_id", payment.company_id)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function sislogInfo(payment: Row) {
  const s = (payment.sislog_response ?? {}) as Row;
  return {
    reference: s.reference ?? null,
    entity: s.entity ?? null,
    provider: s.provider ?? null,
    paidAt: s.paymentdatetime ?? null,
    failureReason: s.failureReason ?? null,
  };
}

function sourceLabel(opts: NotifyOptions): string {
  const who = opts.actorEmail ? ` por ${opts.actorEmail}` : "";
  if (opts.source === "manual") return `Confirmação manual${who}`;
  if (opts.source === "resend") return `Reenvio manual${who}`;
  return "Sislog webhook (pagamento automático)";
}

/**
 * Plano efectivamente activo após o pagamento. Se o webhook recusou um downgrade
 * (sislog_response.downgrade_ignored), o plano superior actual foi mantido e
 * apenas o período foi prolongado.
 */
function activatedPlan(payment: Row, subscription: Row | null): { planName: string; downgradeIgnored: boolean; requestedPlan: string | null } {
  const downgradeIgnored = !!(payment.sislog_response as Row | null)?.downgrade_ignored;
  return {
    planName: (downgradeIgnored ? subscription?.plan_name : null) || payment.plan_name,
    downgradeIgnored,
    requestedPlan: payment.plan_name ?? null,
  };
}

function clientHtml(
  payment: Row,
  ownerName: string | null,
  periodEnd: string,
  plan: ReturnType<typeof activatedPlan>,
): string {
  const companyName = payment.companies?.name || "sua empresa";
  const s = sislogInfo(payment);
  const downgradeNote = plan.downgradeIgnored
    ? `<p>Como a sua subscrição actual (<strong>${escapeHtml(plan.planName)}</strong>) ainda estava activa, não é possível mudar para um plano inferior${plan.requestedPlan ? ` (${escapeHtml(plan.requestedPlan)})` : ""}. O período pago foi acrescentado ao plano actual.</p>`
    : "";
  const inner = `
    <p>Olá <strong>${escapeHtml(ownerName || "Estimado(a) Cliente")}</strong>,</p>
    <p>Confirmamos a recepção do pagamento da subscrição da empresa <strong>${escapeHtml(companyName)}</strong> no ISPC Fácil. A sua subscrição já está activa!</p>
    ${downgradeNote}
    ${detailsTable([
      ["Plano", plan.planName],
      ["Ciclo", cycleLabel(payment.billing_cycle)],
      ["Valor", formatAmount(payment.amount, payment.currency || "MZN")],
      ["Método", `${methodLabel(payment.payment_method)}${payment.phone_number ? ` (${payment.phone_number})` : ""}`],
      ["Referência", s.reference || payment.reference_code],
      ["Válida até", periodEnd],
    ])}
    <p>Agradecemos a sua preferência. Pode continuar a utilizar todas as funcionalidades sem interrupções.</p>`;
  return emailLayout("Confirmação de Pagamento de Subscrição", inner);
}

function adminHtml(
  payment: Row,
  owner: Owner,
  clientRecipients: string[],
  periodEnd: string,
  opts: NotifyOptions,
  plan: ReturnType<typeof activatedPlan>,
): string {
  const c = payment.companies ?? {};
  const s = sislogInfo(payment);
  const inner = `
    <p>Foi registado um pagamento de subscrição concluído.</p>
    ${detailsTable([
      ["Empresa", c.name],
      ["NUIT", c.nuit],
      ["ID da empresa", payment.company_id],
      ["Dono", owner.fullName],
      ["E-mail do dono", owner.email],
      ["Pago por (e-mail)", payment.payer_email],
      ["Plano", plan.planName],
      ...(plan.downgradeIgnored
        ? [["Downgrade recusado", `Pedido "${plan.requestedPlan ?? "—"}" com a subscrição activa; mantido o plano actual e prolongado o período.`] as [string, string]]
        : []),
      ["Ciclo", cycleLabel(payment.billing_cycle)],
      ["Valor", formatAmount(payment.amount, payment.currency || "MZN")],
      ["Método", methodLabel(payment.payment_method)],
      ["Telefone", payment.phone_number],
      ["Código de transacção", payment.reference_code],
      ["Referência Sislog", s.reference],
      ["Entidade", s.entity],
      ["Operador", s.provider],
      ["Data do pagamento", s.paidAt || formatDateTime(payment.updated_at)],
      ["Subscrição válida até", periodEnd],
      ["Origem", sourceLabel(opts)],
      ["Cliente notificado em", clientRecipients.length ? clientRecipients.join(", ") : "Sem destinatário"],
      ["ID do pagamento", payment.id],
    ])}`;
  return emailLayout("Nova subscrição paga", inner, "Notificação interna do ISPC Fácil.");
}

function partFromSend(r: SendEmailResult): NotifyPartResult {
  return { ok: r.ok, status: r.status, recipients: r.recipients, error: r.error };
}

/**
 * Envia a confirmação ao cliente e a notificação interna à LTS para um
 * pagamento já concluído. Nunca lança excepção.
 */
export async function notifySubscriptionActivated(
  db: DbClient,
  paymentId: string,
  opts: NotifyOptions = {},
): Promise<NotifyResult> {
  const source = opts.source ?? "webhook";
  const options: NotifyOptions = { ...opts, source };
  try {
    const payment = await loadPayment(db, paymentId);
    if (!payment) {
      const err = "Pagamento não encontrado.";
      return { ok: false, error: err, client: { ok: false, status: "skipped", error: err }, admin: { ok: false, status: "skipped", error: err } };
    }
    if (payment.status !== "completed") {
      const err = `Pagamento não está concluído (estado: ${payment.status}).`;
      return { ok: false, error: err, client: { ok: false, status: "skipped", error: err }, admin: { ok: false, status: "skipped", error: err } };
    }

    const needClient = options.force || !payment.client_notified_at;
    const needAdmin = options.force || !payment.admin_notified_at;
    if (!needClient && !needAdmin) {
      console.log(`[subscription-notify] payment ${paymentId} already notified; skipping.`);
      return {
        ok: true,
        client: { ok: true, status: "already_sent" },
        admin: { ok: true, status: "already_sent" },
      };
    }

    const owner = await resolveOwner(db, payment);
    const settings = await getCompanyNotificationSettings(db, payment.company_id);
    const settingsEmail = settingsNotificationEmail(settings);
    const clientRecipients = uniqueEmails([owner.email, payment.payer_email, settingsEmail]);

    const subscription = await loadSubscription(db, payment);
    const periodEndRaw = subscription?.end_date || subscription?.next_billing_date || null;
    const periodEnd = formatDate(periodEndRaw);
    // Para o cliente: formato de data e fuso horário da empresa.
    const clientPeriodEnd = periodEndRaw ? formatCompanyDate(periodEndRaw, settings) : "—";
    const companyName = payment.companies?.name || "Empresa";
    const plan = activatedPlan(payment, subscription);

    const common = {
      companyId: payment.company_id,
      relatedTable: "subscription_payments",
      relatedId: payment.id,
    };

    let client: NotifyPartResult = { ok: true, status: "already_sent" };
    if (needClient) {
      client = partFromSend(
        await sendEmail(db, {
          ...common,
          kind: "subscription_activated_client",
          to: clientRecipients,
          subject: "[ISPC Fácil] Subscrição Activada – Confirmação de Pagamento",
          html: clientHtml(payment, owner.fullName, clientPeriodEnd, plan),
        }),
      );
    }

    let admin: NotifyPartResult = { ok: true, status: "already_sent" };
    if (needAdmin) {
      admin = partFromSend(
        await sendEmail(db, {
          ...common,
          kind: "subscription_activated_admin",
          to: adminRecipients(),
          replyTo: owner.email || undefined,
          subject: `[ISPC Fácil] Nova subscrição paga – ${companyName}`,
          html: adminHtml(payment, owner, clientRecipients, periodEnd, options, plan),
        }),
      );
    }

    const now = new Date().toISOString();
    const errors: string[] = [];
    if (needClient && !client.ok) errors.push(`cliente: ${client.error ?? client.status}`);
    if (needAdmin && !admin.ok) errors.push(`admin: ${admin.error ?? admin.status}`);

    const patch: Row = { notification_error: errors.length ? errors.join("; ") : null };
    if (needClient && client.ok) patch.client_notified_at = now;
    if (needAdmin && admin.ok) patch.admin_notified_at = now;

    const { error: updErr } = await db.from("subscription_payments").update(patch).eq("id", payment.id);
    if (updErr) console.warn("[subscription-notify] could not update notification columns:", updErr);

    return { ok: errors.length === 0, client, admin, error: errors.length ? errors.join("; ") : undefined };
  } catch (e) {
    const err = (e as Error)?.message || String(e);
    console.error("[subscription-notify] unexpected error:", e);
    return { ok: false, error: err, client: { ok: false, status: "failed", error: err }, admin: { ok: false, status: "failed", error: err } };
  }
}

/** Aviso interno (só LTS) quando um pagamento falha na carteira móvel. Nunca lança excepção. */
export async function notifySubscriptionPaymentFailed(
  db: DbClient,
  paymentId: string,
  reason: string,
): Promise<NotifyPartResult> {
  try {
    const payment = await loadPayment(db, paymentId);
    if (!payment) return { ok: false, status: "skipped", error: "Pagamento não encontrado." };
    const owner = await resolveOwner(db, payment);
    const c = payment.companies ?? {};
    const s = sislogInfo(payment);
    const inner = `
      <p>Um pagamento de subscrição <strong>falhou</strong> na carteira móvel. O cliente pode precisar de ajuda.</p>
      ${detailsTable([
        ["Empresa", c.name],
        ["NUIT", c.nuit],
        ["Dono", owner.fullName],
        ["E-mail do dono", owner.email],
        ["Pago por (e-mail)", payment.payer_email],
        ["Plano", `${payment.plan_name ?? ""} · ${cycleLabel(payment.billing_cycle)}`],
        ["Valor", formatAmount(payment.amount, payment.currency || "MZN")],
        ["Método", methodLabel(payment.payment_method)],
        ["Telefone", payment.phone_number],
        ["Código de transacção", payment.reference_code],
        ["Operador", s.provider],
        ["Motivo", reason || s.failureReason],
        ["Data", formatDateTime(null)],
        ["ID do pagamento", payment.id],
      ])}`;
    const r = await sendEmail(db, {
      kind: "subscription_payment_failed_admin",
      to: adminRecipients(),
      replyTo: owner.email || undefined,
      subject: `[ISPC Fácil] Pagamento de subscrição falhou – ${c.name || "Empresa"}`,
      html: emailLayout("Pagamento de subscrição falhou", inner, "Notificação interna do ISPC Fácil."),
      companyId: payment.company_id,
      relatedTable: "subscription_payments",
      relatedId: payment.id,
    });
    return partFromSend(r);
  } catch (e) {
    const err = (e as Error)?.message || String(e);
    console.error("[subscription-notify] failure notice error:", e);
    return { ok: false, status: "failed", error: err };
  }
}
