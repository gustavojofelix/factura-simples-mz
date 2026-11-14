import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { runInBackground } from "../_shared/email.ts";
import {
  notifySubscriptionActivated,
  notifySubscriptionPaymentFailed,
} from "../_shared/subscription-notifications.ts";

// Sislog calls this endpoint via GET when a payment succeeds OR fails.
// Success:  entity != "00000"
// Failure:  entity == "00000", errormessage is set (Sislog API v1.3)

serve(async (req) => {
  // CORS support
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  // Log incoming request info for diagnostic visibility
  console.log(`[SislogWebhook] Incoming request: ${req.method} ${req.url}`);
  console.log(
    `[SislogWebhook] Headers:`,
    Object.fromEntries(req.headers.entries()),
  );

  const params: Record<string, string> = {};

  // 1. Parse URL query parameters
  const url = new URL(req.url);
  url.searchParams.forEach((val, key) => {
    params[key.toLowerCase()] = val;
  });

  // 2. If POST request, attempt to read body parameters based on Content-Type
  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      console.log(
        `[SislogWebhook] Parsing POST body with Content-Type: ${contentType}`,
      );

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        console.log(`[SislogWebhook] Raw urlencoded body: ${text}`);
        const searchParams = new URLSearchParams(text);
        searchParams.forEach((val, key) => {
          params[key.toLowerCase()] = val;
        });
      } else if (contentType.includes("application/json")) {
        const body = await req.json();
        console.log(`[SislogWebhook] Raw JSON body:`, JSON.stringify(body));
        if (body && typeof body === "object") {
          Object.keys(body).forEach((key) => {
            params[key.toLowerCase()] = String(body[key] ?? "");
          });
        }
      } else {
        // Fallback: try parsing body as urlencoded text
        const text = await req.text();
        console.log(`[SislogWebhook] Fallback raw body: ${text}`);
        const searchParams = new URLSearchParams(text);
        searchParams.forEach((val, key) => {
          params[key.toLowerCase()] = val;
        });
      }
    } catch (e) {
      console.error("[SislogWebhook] Error parsing POST body:", e);
    }
  }

  console.log(
    `[SislogWebhook] Parsed parameters (lowercased keys):`,
    JSON.stringify(params),
  );

  const entity = params["entity"] || "";
  const reference = params["reference"] || "";
  const value = params["value"] || "0";
  const transactionId =
    params["transactionid"] || params["transaction_id"] || "";
  const provider = params["provider"] || "";
  const paymentdatetime = params["paymentdatetime"] || "";
  const errormessage = params["errormessage"] || "";

  if (!transactionId) {
    console.warn("[SislogWebhook] Missing transactionId. Rejecting request.");
    return new Response("Missing transactionId", {
      status: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // ── Find the matching payment record ─────────────────────────────────────
    console.log(
      `[SislogWebhook] Looking up payment record for reference_code: ${transactionId}`,
    );
    const { data: payment, error: paymentError } = await supabase
      .from("subscription_payments")
      .select("*")
      .eq("reference_code", transactionId)
      .single();

    if (paymentError || !payment) {
      console.error(
        "[SislogWebhook] Payment not found for transactionId:",
        transactionId,
        paymentError,
      );
      return new Response("Payment not found", { status: 404 });
    }

    console.log(
      `[SislogWebhook] Found payment record:`,
      JSON.stringify(payment),
    );

    // ── FAILED PAYMENT (Sislog v1.3) ─────────────────────────────────────────
    // When entity === "00000" the wallet returned an error (e.g. user cancelled / wrong PIN)
    if (entity === "00000") {
      const decodedError = decodeURIComponent(errormessage || "Unknown error");
      console.warn(
        `[SislogWebhook] Payment failed for transactionId ${transactionId}: ${decodedError}`,
      );

      const { error: updateFailedError } = await supabase
        .from("subscription_payments")
        .update({
          status: "failed",
          sislog_response: {
            ...payment.sislog_response,
            failureReason: decodedError,
            provider,
            failedAt: paymentdatetime,
          },
        })
        .eq("id", payment.id);

      if (updateFailedError) {
        console.error(
          "[SislogWebhook] Failed to update payment status to failed:",
          updateFailedError,
        );
        throw updateFailedError;
      }

      // Aviso interno à LTS (só na primeira notificação de falha).
      if (payment.status !== "failed") {
        runInBackground(notifySubscriptionPaymentFailed(supabase, payment.id, decodedError));
      }

      // Must return 200 so Sislog stops retrying
      return new Response("OK", { status: 200 });
    }

    // ── SUCCESSFUL PAYMENT ───────────────────────────────────────────────────
    if (payment.status === "completed") {
      console.log(
        `[SislogWebhook] Payment for transactionId ${transactionId} is already processed.`,
      );
      // Already processed (Sislog retried) — respond 200 to stop retries.
      // Se os e-mails ainda não saíram (ex.: SMTP em falta), tenta de novo.
      // Sem as colunas *_notified_at (migração 20261009110000 por aplicar) não
      // há como saber se já foi enviado: assume que sim, para não duplicar.
      const hasNotifyColumns = "client_notified_at" in payment && "admin_notified_at" in payment;
      if (hasNotifyColumns && (!payment.client_notified_at || !payment.admin_notified_at)) {
        runInBackground(notifySubscriptionActivated(supabase, payment.id, { source: "webhook" }));
      }
      return new Response("OK", { status: 200 });
    }

    // 1. Criar o período de subscrição (entra na fila). Feito ANTES de marcar o
    // pagamento como concluído: se falhar, devolvemos 500, a Sislog volta a
    // tentar e o pagamento continua 'pending'. É idempotente por payment_id.
    // Se a empresa já tem tempo pago, o período começa no dia seguinte ao fim
    // do último; senão começa hoje. O plano escolhido vale nesse período.
    const { data: period, error: periodError } = await supabase.rpc(
      "enqueue_subscription_period",
      {
        p_company_id: payment.company_id,
        p_plan_name: payment.plan_name,
        p_billing_cycle: payment.billing_cycle,
        p_amount: payment.amount,
        p_currency: payment.currency || "MZN",
        p_payment_method: payment.payment_method,
        p_payment_id: payment.id,
        p_source: "payment",
      },
    );
    if (periodError) {
      console.error("[SislogWebhook] enqueue_subscription_period failed:", periodError);
      throw periodError;
    }
    const periodRow = Array.isArray(period) ? period[0] : period;
    console.log(
      `[SislogWebhook] Period for company ${payment.company_id}: ${payment.plan_name} ${periodRow?.start_date} → ${periodRow?.end_date}`,
    );

    // 2. Mark payment as completed
    console.log(`[SislogWebhook] Marking payment ${payment.id} as completed`);
    const { error: updateCompleteError } = await supabase
      .from("subscription_payments")
      .update({
        status: "completed",
        sislog_response: {
          ...payment.sislog_response,
          entity,
          reference,
          value,
          provider,
          paymentdatetime,
          period_start: periodRow?.start_date ?? null,
          period_end: periodRow?.end_date ?? null,
        },
      })
      .eq("id", payment.id);

    if (updateCompleteError) {
      console.error(
        "[SislogWebhook] Failed to update payment status to completed:",
        updateCompleteError,
      );
      throw updateCompleteError;
    }

    // 3. Factura no OfficeGest, emitida já (data de hoje), com as datas do
    // período na descrição. Em runInBackground para o runtime não cortar o
    // pedido quando respondemos à Sislog. Se falhar, o pagamento fica sem
    // officegest_document_id e o admin emite-a em Receitas → Sincronizar.
    runInBackground(
      fetch(`${supabaseUrl}/functions/v1/sync-officegest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ payment_ids: [payment.id] }),
      }).then(async (r) => {
        const txt = await r.text().catch(() => "");
        console.log(`[SislogWebhook] OfficeGest sync result (${r.status}): ${txt}`);
      }),
    );

    // 4. E-mails de confirmação (cliente + LTS) em segundo plano, para responder
    // 200 à Sislog de imediato. notifySubscriptionActivated é idempotente
    // (client_notified_at / admin_notified_at) e regista tudo em email_log.
    runInBackground(
      notifySubscriptionActivated(supabase, payment.id, { source: "webhook" }).then((r) =>
        console.log(`[SislogWebhook] Notifications for ${payment.id}:`, JSON.stringify(r))
      ),
    );

    // Must return 200 so Sislog considers the notification delivered
    return new Response("OK", { status: 200 });
  } catch (error: any) {
    console.error("[SislogWebhook] Error processing Sislog webhook:", error);
    // Return 500 → Sislog will retry every 5 min up to 5 times
    return new Response("Internal Server Error", { status: 500 });
  }
});
