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

    // 0. Downgrade enquanto a subscrição está activa? (ex.: dois pagamentos
    // pendentes em corrida). O dinheiro já foi cobrado, por isso os dias são
    // somados, mas o plano superior actual é mantido e o pagamento fica
    // assinalado (sislog_response.downgrade_ignored) para revisão do admin.
    let downgradeIgnored = false;
    {
      const { data: isDowngrade, error: downgradeError } = await supabase.rpc(
        "is_subscription_downgrade",
        { p_company_id: payment.company_id, p_target_plan: payment.plan_name },
      );
      if (downgradeError) {
        console.warn("[SislogWebhook] is_subscription_downgrade failed:", downgradeError.message);
      } else if (isDowngrade === true) {
        downgradeIgnored = true;
        console.warn(
          `[SislogWebhook] Payment ${payment.id} requested a downgrade to "${payment.plan_name}" while the current subscription is active — keeping the current plan and only extending the period.`,
        );
      }
    }

    // 1. Mark payment as completed
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
          ...(downgradeIgnored
            ? { downgrade_ignored: true, downgrade_requested_plan: payment.plan_name }
            : {}),
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

    // 2. Activate or extend the subscription. A payment made while the
    // subscription is active starts after its current end date, so paid days
    // are never lost. Expired subscriptions start from today.
    // Os pacotes contam em dias (1 mês = 30 dias), igual a subscription_cycle_days() no SQL.
    const daysToAdd = payment.billing_cycle === "yearly"
      ? 360
      : payment.billing_cycle === "semiannual"
        ? 180
        : payment.billing_cycle === "quarterly"
          ? 90
          : 30;
    const today = new Date();
    const todayStr = today.toISOString().substring(0, 10);

    const addDaysToDate = (date: Date, days: number): Date => {
      const result = new Date(date);
      result.setUTCDate(result.getUTCDate() + days);
      return result;
    };

    let existingSubscription: any = null;
    if (payment.subscription_id) {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, start_date, end_date, plan_name, billing_cycle, amount")
        .eq("id", payment.subscription_id)
        .maybeSingle();
      existingSubscription = data;
    }

    if (!existingSubscription) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, start_date, end_date, plan_name, billing_cycle, amount")
        .eq("company_id", payment.company_id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      existingSubscription = data;
    }

    const currentEnd = existingSubscription?.end_date
      ? new Date(`${existingSubscription.end_date}T00:00:00Z`)
      : null;
    const todayStart = new Date(`${todayStr}T00:00:00Z`);
    const isActivePeriod = !!currentEnd && currentEnd.getTime() >= todayStart.getTime();
    const periodStart = isActivePeriod
      ? existingSubscription.start_date
      : todayStr;
    const newEnd = addDaysToDate(isActivePeriod ? currentEnd! : todayStart, daysToAdd);
    const nextBillingDateStr = newEnd.toISOString().substring(0, 10);
    const startDateStr = periodStart || todayStr;

    console.log(
      `[SislogWebhook] Activating subscription for company: ${payment.company_id}. Start date: ${startDateStr}, End/Next billing: ${nextBillingDateStr}`,
    );

    if (existingSubscription?.id) {
      console.log(
        `[SislogWebhook] Updating existing subscription by ID: ${existingSubscription.id}`,
      );
      const { error: updateSubError } = await supabase
        .from("subscriptions")
        .update({
          // Downgrade bloqueado: mantém plano/ciclo/valor actuais, só soma os dias.
          ...(downgradeIgnored
            ? {}
            : {
              plan_name: payment.plan_name,
              billing_cycle: payment.billing_cycle,
              amount: payment.amount,
            }),
          status: "active",
          payment_method: payment.payment_method,
          start_date: startDateStr,
          end_date: nextBillingDateStr,
          next_billing_date: nextBillingDateStr,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSubscription.id);

      if (updateSubError) {
        console.error(
          "[SislogWebhook] Error updating subscription:",
          updateSubError,
        );
        throw updateSubError;
      }
    } else {
      console.log(
        `[SislogWebhook] Inserting new subscription record for company: ${payment.company_id}`,
      );
      const { error: insertSubError } = await supabase
        .from("subscriptions")
        .insert({
          company_id: payment.company_id,
          plan_name: payment.plan_name,
          billing_cycle: payment.billing_cycle,
          amount: payment.amount,
          status: "active",
          payment_method: payment.payment_method,
          start_date: startDateStr,
          end_date: nextBillingDateStr,
          next_billing_date: nextBillingDateStr,
          updated_at: new Date().toISOString(),
        });

      if (insertSubError) {
        console.error(
          "[SislogWebhook] Error inserting new subscription:",
          insertSubError,
        );
        throw insertSubError;
      }
    }


    // 3. Emit invoice in OfficeGest (fire-and-forget — non-blocking)
    // This call does not affect Sislog retries; errors are logged only.
    try {
      const syncUrl = `${supabaseUrl}/functions/v1/sync-officegest`;
      fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ payment_ids: [payment.id] }),
      }).then(async (r) => {
        const txt = await r.text().catch(() => "");
        console.log(`[SislogWebhook] OfficeGest sync result (${r.status}): ${txt}`);
      }).catch((e) => {
        console.warn("[SislogWebhook] OfficeGest sync call failed (non-critical):", e);
      });
    } catch (syncErr) {
      console.warn("[SislogWebhook] OfficeGest sync setup failed (non-critical):", syncErr);
    }

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
