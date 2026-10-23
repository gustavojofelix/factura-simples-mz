import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  adminRecipients,
  detailsTable,
  emailLayout,
  escapeHtml,
  isEmail,
  sendEmail,
} from "../_shared/email.ts";
import { accountOrigin } from "../_shared/account-url.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * Boas-vindas ao novo subscritor, com o endereço da sua conta.
 * Só é enviado ao utilizador dono do JWT do pedido (nunca a um email vindo do
 * corpo), uma única vez, e só para registos recentes.
 */
async function sendWelcomeEmail(db: Admin, req: Request): Promise<void> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await db.auth.getUser(jwt);
  const user = userData?.user;
  // Sem sessão (ex.: confirmação de email activa) o Supabase já envia o seu próprio email.
  if (!user?.email) return;

  const ageMs = Date.now() - new Date(user.created_at).getTime();
  if (!(ageMs >= 0 && ageMs < 60 * 60 * 1000)) return;

  const { data: already } = await db
    .from("email_log")
    .select("id")
    .eq("kind", "signup_welcome")
    .eq("related_id", user.id)
    .eq("status", "sent")
    .limit(1);
  if (already && already.length > 0) return;

  const { data: account } = await db
    .from("accounts")
    .select("slug, name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const origin = accountOrigin(account?.slug);
  const loginUrl = `${origin}/#/entrar`;
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";

  const inner = `
      <p>Olá${fullName ? ` ${escapeHtml(fullName)}` : ""},</p>
      <p>A sua conta no <strong>ISPC Fácil</strong> foi criada com sucesso. Guarde o endereço abaixo: é por ele que acede sempre à sua conta.</p>
      ${detailsTable([
        ["Endereço da conta", origin.replace(/^https?:\/\//, "")],
        ["Email de acesso", user.email],
      ])}
      <p style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(loginUrl)}" style="background-color:#f16c39;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;display:inline-block;">Aceder à minha conta</a>
      </p>
      <p><strong>Próximo passo:</strong> configure a sua primeira empresa (nome, NUIT e dados fiscais) para começar a emitir facturas.</p>
      <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie este link para o navegador:<br/>${escapeHtml(loginUrl)}</p>`;

  await sendEmail(db, {
    kind: "signup_welcome",
    to: user.email,
    subject: "Bem-vindo ao ISPC Fácil — a sua conta foi criada",
    html: emailLayout("Conta criada com sucesso", inner),
    relatedTable: "auth.users",
    relatedId: user.id,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, email, fullName, phone, accountSlug } = await req.json();

    if (!isEmail(email)) {
      return json({ success: false, error: "Email is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const db = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    const isInvite = type === 'invite';
    const actionText = isInvite ? 'convidado para a plataforma' : 'registado na plataforma';
    const subject = isInvite
      ? `[Notificação] Novo Utilizador Convidado - ISPC Fácil`
      : `[Notificação] Novo Registo de Conta - ISPC Fácil`;

    const inner = `
      <p>Olá Administrador,</p>
      <p>Um novo utilizador foi <strong>${escapeHtml(actionText)}</strong>.</p>
      ${detailsTable([
        ["Email", String(email).trim()],
        ["Nome Completo", typeof fullName === "string" ? fullName.slice(0, 200) : ""],
        ["Telefone", typeof phone === "string" ? phone.slice(0, 50) : ""],
        ["Conta", typeof accountSlug === "string" ? accountSlug.slice(0, 40) : ""],
        ["Data/Hora", new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' })],
      ])}`;

    const result = await sendEmail(db, {
      kind: isInvite ? "invite_admin" : "signup_admin",
      to: adminRecipients(),
      replyTo: String(email).trim(),
      subject,
      html: emailLayout("Notificação de Sistema", inner, "Este é um e-mail automático do sistema de notificações do ISPC Fácil."),
      relatedTable: "profiles",
      relatedId: String(email).trim().toLowerCase(),
    });

    if (!isInvite && db) {
      try {
        await sendWelcomeEmail(db, req);
      } catch (e) {
        console.error("Failed to send welcome email:", e);
      }
    }

    if (!result.ok) {
      return json({ success: false, status: result.status, error: result.error }, result.status === "skipped" ? 200 : 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error("Failed to send notification email:", error);
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
