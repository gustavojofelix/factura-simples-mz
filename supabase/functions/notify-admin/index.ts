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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, email, fullName, phone } = await req.json();

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

    if (!result.ok) {
      return json({ success: false, status: result.status, error: result.error }, result.status === "skipped" ? 200 : 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error("Failed to send notification email:", error);
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
