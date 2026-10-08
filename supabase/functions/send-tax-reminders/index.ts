import "@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@6.9.11";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Lembretes de obrigações fiscais (Modelo 30 / ISPC) por email.
 *
 * Chamada só por agendador (pg_cron + pg_net, ou externo) com o cabeçalho
 * `x-cron-secret`. Passos:
 *
 *  1. Gera os lembretes do dia com `generate_tax_reminders` (idempotente).
 *     Para testes aceita `reference_date` (AAAA-MM-DD) e `company_id`.
 *  2. Envia por email os lembretes ainda não enviados (`emailed_at` nulo),
 *     agrupados numa mensagem por empresa, para o dono da conta e para o
 *     email da empresa.
 *  3. Marca cada lembrete com `emailed_at` ou `email_error`.
 *
 * Com `dry_run: true` os lembretes são gerados mas nenhum email é enviado nem
 * nenhum lembrete é marcado; a resposta mostra o que seria enviado.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Tecto por execução, para não exceder o tempo limite da função. */
const MAX_REMINDERS_PER_RUN = 500;

interface RequestBody {
  reference_date?: string;
  company_id?: string;
  dry_run?: boolean;
  skip_generate?: boolean;
}

interface Reminder {
  id: string;
  company_id: string;
  year: number;
  quarter: number;
  kind: "d15" | "d7" | "d1" | "overdue";
  due_date: string;
  title: string;
  body: string;
  created_at: string;
}

interface Company {
  id: string;
  name: string;
  email: string | null;
  user_id: string;
  nuit: string | null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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

const KIND_STYLE: Record<Reminder["kind"], { label: string; color: string; bg: string }> = {
  d15: { label: "Lembrete", color: "#1d4ed8", bg: "#eff6ff" },
  d7: { label: "Aviso", color: "#c2410c", bg: "#fff7ed" },
  d1: { label: "Urgente", color: "#b91c1c", bg: "#fef2f2" },
  overdue: { label: "Incumprimento", color: "#991b1b", bg: "#fee2e2" },
};

function buildSubject(company: Company, reminders: Reminder[]): string {
  const overdue = reminders.some((r) => r.kind === "overdue");
  const base = overdue
    ? "Incumprimento fiscal: Modelo 30 em atraso"
    : reminders.length === 1
    ? reminders[0].title
    : "Lembrete: prazo do Modelo 30 (ISPC)";
  return sanitizeHeader(`${base} — ${company.name}`);
}

function buildHtml(company: Company, reminders: Reminder[], appUrl: string): string {
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

function buildText(company: Company, reminders: Reminder[], appUrl: string): string {
  return [
    `Caro contribuinte ${company.name},`,
    "",
    ...reminders.map((r) => `${r.title}\n${r.body}\n`),
    `Gestão de Impostos: ${appUrl.replace(/\/$/, "")}/impostos`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, 401);
  }

  let body: RequestBody = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "Pedido inválido.", code: "BAD_REQUEST" }, 400);
  }

  if (body.reference_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.reference_date)) {
    return json({ error: "reference_date deve estar no formato AAAA-MM-DD.", code: "BAD_REQUEST" }, 400);
  }

  const dryRun = body.dry_run === true;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- 1. Gerar --------------------------------------------------------------
  let generated: number | null = null;
  if (!body.skip_generate) {
    const args: Record<string, string> = {};
    if (body.reference_date) args.p_reference_date = body.reference_date;
    if (body.company_id) args.p_company_id = body.company_id;

    const { data, error } = await admin.rpc("generate_tax_reminders", args);
    if (error) {
      console.error("send-tax-reminders (gerar):", error.message);
      return json({ error: error.message }, 500);
    }
    generated = data as number;
  }

  // --- 2. Pendentes de envio -------------------------------------------------
  let query = admin
    .from("tax_reminders")
    .select("id, company_id, year, quarter, kind, due_date, title, body, created_at")
    .is("emailed_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_REMINDERS_PER_RUN);
  if (body.company_id) query = query.eq("company_id", body.company_id);

  const { data: pending, error: pendingError } = await query;
  if (pendingError) {
    return json({ error: pendingError.message }, 500);
  }

  const reminders = (pending ?? []) as Reminder[];
  const byCompany = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const list = byCompany.get(r.company_id) ?? [];
    list.push(r);
    byCompany.set(r.company_id, list);
  }

  const summary = {
    generated,
    reference_date: body.reference_date ?? null,
    dry_run: dryRun,
    pending: reminders.length,
    companies: byCompany.size,
    emails_sent: 0,
    reminders_emailed: 0,
    failures: 0,
    details: [] as Array<{
      company_id: string;
      company_name?: string;
      recipients: string[];
      reminders: Array<{ kind: string; year: number; quarter: number; title: string }>;
      status: "enviado" | "simulado" | "erro";
      error?: string;
    }>,
  };

  if (byCompany.size === 0) {
    return json(summary);
  }

  const { data: companiesData, error: companiesError } = await admin
    .from("companies")
    .select("id, name, email, user_id, nuit")
    .in("id", [...byCompany.keys()]);
  if (companiesError) {
    return json({ error: companiesError.message }, 500);
  }
  const companies = new Map(
    ((companiesData ?? []) as Company[]).map((c) => [c.id, c]),
  );

  const appUrl = Deno.env.get("SITE_URL") ?? "https://ispcfacil.co.mz";
  const fromAddress = Deno.env.get("SMTP_FROM_EMAIL") ?? Deno.env.get("SMTP_USER") ?? "";

  let transporter: ReturnType<typeof buildTransport> | null = null;
  if (!dryRun) {
    try {
      transporter = buildTransport();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Sem SMTP não se marca nada: os lembretes ficam na fila para a
      // próxima execução, quando a configuração estiver corrigida.
      return json({ ...summary, error: message }, 500);
    }
  }

  // --- 3. Enviar -------------------------------------------------------------
  for (const [companyId, list] of byCompany) {
    const company = companies.get(companyId);
    const ids = list.map((r) => r.id);
    const detail = {
      company_id: companyId,
      company_name: company?.name,
      recipients: [] as string[],
      reminders: list.map((r) => ({ kind: r.kind, year: r.year, quarter: r.quarter, title: r.title })),
      status: "simulado" as "enviado" | "simulado" | "erro",
      error: undefined as string | undefined,
    };

    try {
      if (!company) throw new Error("Empresa não encontrada.");

      const recipients = new Set<string>();
      const { data: owner } = await admin.auth.admin.getUserById(company.user_id);
      if (isEmail(owner?.user?.email)) recipients.add(owner!.user!.email!.trim().toLowerCase());
      if (isEmail(company.email)) recipients.add(company.email.trim().toLowerCase());
      detail.recipients = [...recipients];

      if (recipients.size === 0) throw new Error("Sem endereço de email para a empresa.");

      // Mais urgentes primeiro dentro da mensagem.
      const order = { overdue: 0, d1: 1, d7: 2, d15: 3 } as const;
      list.sort((a, b) => order[a.kind] - order[b.kind]);

      if (!dryRun && transporter) {
        await transporter.sendMail({
          from: `"ISPC Fácil" <${fromAddress}>`,
          sender: fromAddress,
          to: [...recipients].join(", "),
          subject: buildSubject(company, list),
          html: buildHtml(company, list, appUrl),
          text: buildText(company, list, appUrl),
        });

        await admin
          .from("tax_reminders")
          .update({ emailed_at: new Date().toISOString(), email_error: null })
          .in("id", ids);

        detail.status = "enviado";
        summary.emails_sent += 1;
        summary.reminders_emailed += ids.length;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      detail.status = "erro";
      detail.error = message;
      summary.failures += 1;
      console.error(`send-tax-reminders (${companyId}):`, message);

      if (!dryRun) {
        // Fica registado o erro; emailed_at continua nulo e o envio é
        // novamente tentado na próxima execução.
        await admin
          .from("tax_reminders")
          .update({ email_error: message.slice(0, 500) })
          .in("id", ids);
      }
    }

    summary.details.push(detail);
  }

  return json(summary);
});
