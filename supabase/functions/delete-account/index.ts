import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { emailLayout, escapeHtml, isEmail, noticeBox, sendEmail } from "../_shared/email.ts";
import { type EmailLanguage, getUserLanguage, type Localized, normalizeLanguage, pick } from "../_shared/i18n.ts";

/**
 * Eliminação de conta (Perfil → "Eliminar conta").
 *
 * Acções (corpo JSON `{ action, ... }`):
 *  - 'request_code' (JWT): envia um código de 6 dígitos para o email da conta.
 *  - 'confirm' (JWT, `code`): confirma o pedido; a conta fica 'pending' durante
 *    30 dias (GRACE_DAYS). O utilizador ainda pode entrar para cancelar.
 *  - 'cancel' (JWT): cancela o pedido em aberto.
 *  - 'process' (cabeçalho x-cron-secret): trata os pedidos cujo prazo terminou —
 *    anonimiza os dados (process_account_deletion), apaga os utilizadores dos
 *    terminais POS das empresas encerradas e bane/anonimiza o utilizador em
 *    auth.users. Os documentos fiscais são conservados (10 anos).
 *
 * Não podem eliminar a conta por aqui: administradores da plataforma e
 * utilizadores de terminais POS.
 */

const GRACE_DAYS = 30;
const CODE_TTL_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;
const MAX_PER_RUN = 50;
const DELETED_EMAIL_DOMAIN = "@deleted.ispcfacil.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// deno-lint-ignore no-explicit-any
type Admin = any;

const ERRORS = {
  UNAUTHENTICATED: {
    "pt-MZ": "Sessão inválida. Entre novamente no sistema.",
    "en-GB": "Invalid session. Please sign in again.",
    "fr-FR": "Session invalide. Veuillez vous reconnecter.",
  },
  NOT_ALLOWED: {
    "pt-MZ": "Esta conta não pode ser eliminada a partir da aplicação. Contacte o apoio ao cliente.",
    "en-GB": "This account cannot be deleted from the app. Please contact customer support.",
    "fr-FR": "Ce compte ne peut pas être supprimé depuis l'application. Contactez l'assistance.",
  },
  ALREADY_PENDING: {
    "pt-MZ": "Já existe um pedido de eliminação em curso para esta conta.",
    "en-GB": "There is already a deletion request in progress for this account.",
    "fr-FR": "Une demande de suppression est déjà en cours pour ce compte.",
  },
  TOO_SOON: {
    "pt-MZ": "Aguarde um minuto antes de pedir um novo código.",
    "en-GB": "Please wait a minute before requesting a new code.",
    "fr-FR": "Veuillez patienter une minute avant de demander un nouveau code.",
  },
  EMAIL_FAILED: {
    "pt-MZ": "Não foi possível enviar o código por email. Tente novamente mais tarde.",
    "en-GB": "We could not send the code by e-mail. Please try again later.",
    "fr-FR": "Impossible d'envoyer le code par e-mail. Réessayez plus tard.",
  },
  NO_CODE: {
    "pt-MZ": "Peça primeiro um código de confirmação.",
    "en-GB": "Please request a confirmation code first.",
    "fr-FR": "Demandez d'abord un code de confirmation.",
  },
  CODE_EXPIRED: {
    "pt-MZ": "O código expirou. Peça um novo código.",
    "en-GB": "The code has expired. Please request a new one.",
    "fr-FR": "Le code a expiré. Demandez-en un nouveau.",
  },
  CODE_INVALID: {
    "pt-MZ": "Código incorrecto.",
    "en-GB": "Incorrect code.",
    "fr-FR": "Code incorrect.",
  },
  NOTHING_TO_CANCEL: {
    "pt-MZ": "Não existe nenhum pedido de eliminação em curso.",
    "en-GB": "There is no deletion request in progress.",
    "fr-FR": "Aucune demande de suppression en cours.",
  },
  UNKNOWN: {
    "pt-MZ": "Ocorreu um erro. Tente novamente.",
    "en-GB": "Something went wrong. Please try again.",
    "fr-FR": "Une erreur s'est produite. Veuillez réessayer.",
  },
} satisfies Record<string, Localized>;

type ErrorCode = keyof typeof ERRORS;

class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode) {
    super(code);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashCode(userId: string, code: string): Promise<string> {
  return sha256(`${userId}:${code}`);
}

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

function formatDate(iso: string, language: EmailLanguage): string {
  return new Intl.DateTimeFormat(language, { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Maputo" })
    .format(new Date(iso));
}

async function audit(admin: Admin, userId: string, email: string | null, action: string, details: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert({
    user_id: userId,
    user_email: email,
    company_id: null,
    action,
    category: "auth",
    details,
  });
  if (error) console.warn("[delete-account] audit_logs:", error.message ?? error);
}

// ── Emails ────────────────────────────────────────────────────────────────

const MAIL = {
  codeSubject: {
    "pt-MZ": "Código para eliminar a sua conta",
    "en-GB": "Code to delete your account",
    "fr-FR": "Code pour supprimer votre compte",
  },
  codeIntro: {
    "pt-MZ": "Recebemos um pedido para eliminar a sua conta ISPC Fácil. Use este código para confirmar:",
    "en-GB": "We received a request to delete your ISPC Fácil account. Use this code to confirm:",
    "fr-FR": "Nous avons reçu une demande de suppression de votre compte ISPC Fácil. Utilisez ce code pour confirmer :",
  },
  codeExpiry: {
    "pt-MZ": `O código é válido durante ${CODE_TTL_MINUTES} minutos. Se não foi você, ignore este email e altere a sua palavra-passe.`,
    "en-GB": `The code is valid for ${CODE_TTL_MINUTES} minutes. If this wasn't you, ignore this e-mail and change your password.`,
    "fr-FR": `Le code est valable ${CODE_TTL_MINUTES} minutes. Si ce n'était pas vous, ignorez cet e-mail et changez votre mot de passe.`,
  },
  scheduledSubject: {
    "pt-MZ": "A sua conta será eliminada",
    "en-GB": "Your account will be deleted",
    "fr-FR": "Votre compte sera supprimé",
  },
  scheduledBody: {
    "pt-MZ": "O pedido de eliminação da sua conta foi confirmado. A conta será eliminada em {date}. Até lá pode cancelar: basta entrar na aplicação e escolher \"Cancelar eliminação\".",
    "en-GB": "Your account deletion request has been confirmed. The account will be deleted on {date}. Until then you can cancel: just sign in to the app and choose \"Cancel deletion\".",
    "fr-FR": "Votre demande de suppression de compte a été confirmée. Le compte sera supprimé le {date}. D'ici là, vous pouvez annuler : connectez-vous à l'application et choisissez « Annuler la suppression ».",
  },
  retention: {
    "pt-MZ": "Os documentos fiscais emitidos (facturas, recibos, notas de crédito) são conservados durante 10 anos, como exige a lei, e não ficam acessíveis a ninguém fora dessa obrigação.",
    "en-GB": "Tax documents issued (invoices, receipts, credit notes) are kept for 10 years, as required by law, and are not accessible to anyone beyond that obligation.",
    "fr-FR": "Les documents fiscaux émis (factures, reçus, avoirs) sont conservés pendant 10 ans, comme l'exige la loi, et ne sont accessibles à personne en dehors de cette obligation.",
  },
  deletedSubject: {
    "pt-MZ": "A sua conta foi eliminada",
    "en-GB": "Your account has been deleted",
    "fr-FR": "Votre compte a été supprimé",
  },
  deletedBody: {
    "pt-MZ": "A sua conta ISPC Fácil foi eliminada. Os seus dados pessoais foram removidos e as suas empresas foram encerradas. Obrigado por ter usado o ISPC Fácil.",
    "en-GB": "Your ISPC Fácil account has been deleted. Your personal data has been removed and your companies have been closed. Thank you for using ISPC Fácil.",
    "fr-FR": "Votre compte ISPC Fácil a été supprimé. Vos données personnelles ont été effacées et vos entreprises ont été clôturées. Merci d'avoir utilisé ISPC Fácil.",
  },
} satisfies Record<string, Localized>;

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;">${escapeHtml(text)}</p>`;
}

async function sendCodeEmail(admin: Admin, to: string, code: string, language: EmailLanguage) {
  const title = pick(MAIL.codeSubject, language);
  const codeHtml =
    `<p style="margin:16px 0;font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;">${escapeHtml(code)}</p>`;
  const html = emailLayout(
    title,
    paragraph(pick(MAIL.codeIntro, language)) + codeHtml + paragraph(pick(MAIL.codeExpiry, language)),
    undefined,
    language,
  );
  return sendEmail(admin, { kind: "account_deletion_code", to, subject: title, html });
}

async function sendScheduledEmail(admin: Admin, to: string, scheduledFor: string, language: EmailLanguage) {
  const title = pick(MAIL.scheduledSubject, language);
  const body = pick(MAIL.scheduledBody, language).replace("{date}", formatDate(scheduledFor, language));
  const html = emailLayout(
    title,
    paragraph(body) + noticeBox(escapeHtml(pick(MAIL.retention, language))),
    undefined,
    language,
  );
  return sendEmail(admin, { kind: "account_deletion_scheduled", to, subject: title, html });
}

async function sendDeletedEmail(admin: Admin, to: string, language: EmailLanguage) {
  const title = pick(MAIL.deletedSubject, language);
  const html = emailLayout(
    title,
    paragraph(pick(MAIL.deletedBody, language)) + noticeBox(escapeHtml(pick(MAIL.retention, language))),
    undefined,
    language,
  );
  return sendEmail(admin, { kind: "account_deletion_completed", to, subject: title, html });
}

// ── Acções do utilizador ─────────────────────────────────────────────────

interface Caller {
  id: string;
  email: string | null;
}

async function authenticateUser(req: Request, admin: Admin): Promise<Caller> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new HttpError(401, "UNAUTHENTICATED");
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user) throw new HttpError(401, "UNAUTHENTICATED");
  return { id: user.id, email: isEmail(user.email) ? user.email.trim() : null };
}

/** Administradores da plataforma e terminais POS não eliminam a conta por aqui. */
async function assertCanDelete(admin: Admin, caller: Caller) {
  if (!caller.email) throw new HttpError(403, "NOT_ALLOWED");
  const [{ data: profile }, { data: terminal }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", caller.id).maybeSingle(),
    admin.from("pos_terminals").select("id").eq("auth_user_id", caller.id).maybeSingle(),
  ]);
  if (profile?.role === "admin" || terminal) throw new HttpError(403, "NOT_ALLOWED");
}

async function openRequest(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["awaiting_code", "pending", "failed"])
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function requestCode(admin: Admin, caller: Caller, language: EmailLanguage) {
  await assertCanDelete(admin, caller);
  const existing = await openRequest(admin, caller.id);
  if (existing && existing.status !== "awaiting_code") throw new HttpError(409, "ALREADY_PENDING");
  if (existing?.code_sent_at && Date.now() - new Date(existing.code_sent_at).getTime() < CODE_RESEND_SECONDS * 1000) {
    throw new HttpError(429, "TOO_SOON");
  }

  const code = randomCode();
  const now = new Date();
  const fields = {
    code_hash: await hashCode(caller.id, code),
    code_sent_at: now.toISOString(),
    code_expires_at: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(),
    code_attempts: 0,
  };

  const { error } = existing
    ? await admin.from("account_deletion_requests").update(fields).eq("id", existing.id)
    : await admin.from("account_deletion_requests").insert({ user_id: caller.id, status: "awaiting_code", ...fields });
  if (error) throw error;

  const sent = await sendCodeEmail(admin, caller.email!, code, language);
  if (!sent.ok) throw new HttpError(502, "EMAIL_FAILED");

  return { success: true, email: caller.email };
}

async function confirm(admin: Admin, caller: Caller, code: unknown, language: EmailLanguage) {
  await assertCanDelete(admin, caller);
  const existing = await openRequest(admin, caller.id);
  if (existing && existing.status !== "awaiting_code") throw new HttpError(409, "ALREADY_PENDING");
  if (!existing?.code_hash) throw new HttpError(400, "NO_CODE");
  if (new Date(existing.code_expires_at).getTime() < Date.now() || existing.code_attempts >= CODE_MAX_ATTEMPTS) {
    throw new HttpError(400, "CODE_EXPIRED");
  }

  const clean = typeof code === "string" ? code.replace(/\D/g, "") : "";
  if (clean.length !== 6 || (await hashCode(caller.id, clean)) !== existing.code_hash) {
    await admin.from("account_deletion_requests")
      .update({ code_attempts: existing.code_attempts + 1 })
      .eq("id", existing.id);
    throw new HttpError(400, "CODE_INVALID");
  }

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + GRACE_DAYS * 86_400_000).toISOString();
  const { error } = await admin.from("account_deletion_requests").update({
    status: "pending",
    code_hash: null,
    code_expires_at: null,
    requested_at: now.toISOString(),
    scheduled_for: scheduledFor,
  }).eq("id", existing.id);
  if (error) throw error;

  await audit(admin, caller.id, caller.email, "Pedido de Eliminação de Conta", { scheduled_for: scheduledFor });
  await sendScheduledEmail(admin, caller.email!, scheduledFor, language);

  return { success: true, scheduled_for: scheduledFor };
}

async function cancel(admin: Admin, caller: Caller) {
  const existing = await openRequest(admin, caller.id);
  if (!existing) throw new HttpError(404, "NOTHING_TO_CANCEL");

  const { error } = await admin.from("account_deletion_requests").update({
    status: "cancelled",
    code_hash: null,
    cancelled_at: new Date().toISOString(),
  }).eq("id", existing.id);
  if (error) throw error;

  if (existing.status !== "awaiting_code") {
    await audit(admin, caller.id, caller.email, "Eliminação de Conta Cancelada", { request_id: existing.id });
  }
  return { success: true };
}

// ── Processamento diário ─────────────────────────────────────────────────

async function processOne(admin: Admin, request: { id: string; user_id: string; status: string }) {
  const userId = request.user_id;
  const { data: authData } = await admin.auth.admin.getUserById(userId);
  const authUser = authData?.user;
  const originalEmail = authUser?.email && !authUser.email.endsWith(DELETED_EMAIL_DOMAIN) ? authUser.email : null;
  const language = await getUserLanguage(admin, userId);

  // 1. Dados da plataforma (empresas encerradas, perfil anonimizado, ...).
  const { data: result, error: rpcError } = await admin.rpc("process_account_deletion", { p_user_id: userId });
  if (rpcError) throw new Error(`process_account_deletion: ${rpcError.message}`);
  if (result?.auth_cleanup && result.auth_cleanup !== "ok") {
    console.warn(`[delete-account] limpeza de sessões/identidades ${userId}:`, result.auth_cleanup);
  }

  // 2. Utilizadores dos terminais POS das empresas encerradas.
  for (const posUserId of (result?.pos_auth_user_ids ?? []) as string[]) {
    const { error } = await admin.auth.admin.deleteUser(posUserId);
    if (error) console.warn(`[delete-account] terminal POS ${posUserId}:`, error.message);
  }

  // 3. auth.users: email anónimo, metadados apagados, banido.
  if (authUser) {
    const clearedMetadata = Object.fromEntries(Object.keys(authUser.user_metadata ?? {}).map((k) => [k, null]));
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email: result.anon_email,
      email_confirm: true,
      user_metadata: clearedMetadata,
      ban_duration: "876000h",
    });
    if (error) throw new Error(`auth.updateUser: ${error.message}`);
  }

  await admin.from("account_deletion_requests").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    last_error: null,
  }).eq("id", request.id);

  await audit(admin, userId, null, "Conta Eliminada", {
    request_id: request.id,
    closed_companies: result?.company_ids ?? [],
  });

  // 4. Aviso final para o endereço original (só na primeira tentativa).
  if (originalEmail && request.status === "pending") {
    await sendDeletedEmail(admin, originalEmail, language);
  }
}

async function processDue(admin: Admin) {
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select("id, user_id, status")
    .in("status", ["pending", "failed"])
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw error;

  let completed = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const request of data ?? []) {
    try {
      await processOne(admin, request);
      completed++;
    } catch (e) {
      const message = (e as Error)?.message || String(e);
      console.error(`[delete-account] pedido ${request.id}:`, message);
      failed.push({ id: request.id, error: message });
      await admin.from("account_deletion_requests")
        .update({ status: "failed", last_error: message.slice(0, 1000) })
        .eq("id", request.id);
    }
  }
  return { success: true, processed: (data ?? []).length, completed, failed };
}

// ── Entrada ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
  } catch { /* corpo vazio */ }

  let language = normalizeLanguage(body?.language);

  try {
    const headerSecret = req.headers.get("x-cron-secret");
    if (body?.action === "process" || headerSecret) {
      const cronSecret = Deno.env.get("CRON_SECRET");
      if (!cronSecret || headerSecret !== cronSecret) return json({ success: false, error: "Unauthorized" }, 401);
      return json(await processDue(admin));
    }

    const caller = await authenticateUser(req, admin);
    if (!body?.language) language = await getUserLanguage(admin, caller.id);

    switch (body?.action) {
      case "request_code":
        return json(await requestCode(admin, caller, language));
      case "confirm":
        return json(await confirm(admin, caller, body?.code, language));
      case "cancel":
        return json(await cancel(admin, caller));
      default:
        return json({ success: false, error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ success: false, code: e.code, error: pick(ERRORS[e.code], language) }, e.status);
    }
    console.error("[delete-account]", e);
    return json({ success: false, code: "UNKNOWN", error: pick(ERRORS.UNKNOWN, language) }, 500);
  }
});
