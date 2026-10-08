// Envia (ou reenvia) os e-mails de um pagamento de subscrição concluído.
// Usado pelo painel de receitas do admin, depois de uma confirmação manual
// e no botão "Reenviar e-mails". Só administradores da plataforma.
//
// Body: { paymentId: string, force?: boolean, source?: 'manual' | 'resend' }
// Resposta: { success, client: {ok,status,error}, admin: {ok,status,error}, error? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { notifySubscriptionActivated } from "../_shared/subscription-notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ success: false, error: "Configuração do servidor em falta." }, 500);
  }
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Autenticação: só administradores ──────────────────────────────────────
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ success: false, error: "Não autenticado." }, 401);

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ success: false, error: "Sessão inválida." }, 401);
  }
  const { data: profile } = await db
    .from("profiles")
    .select("role, email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return json({ success: false, error: "Apenas administradores podem enviar estas notificações." }, 403);
  }

  // ── Pedido ────────────────────────────────────────────────────────────────
  let body: { paymentId?: string; force?: boolean; source?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Pedido inválido." }, 400);
  }
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (!paymentId) return json({ success: false, error: "paymentId é obrigatório." }, 400);

  const force = body.force === true;
  const source = body.source === "resend" || force ? "resend" : "manual";

  const result = await notifySubscriptionActivated(db, paymentId, {
    source,
    force,
    actorEmail: profile?.email || userData.user.email || null,
  });

  return json({ success: result.ok, ...result });
});
