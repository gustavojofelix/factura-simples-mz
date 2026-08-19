import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import nodemailer from "npm:nodemailer@6.9.11";

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

      // Must return 200 so Sislog stops retrying
      return new Response("OK", { status: 200 });
    }

    // ── SUCCESSFUL PAYMENT ───────────────────────────────────────────────────
    if (payment.status === "completed") {
      console.log(
        `[SislogWebhook] Payment for transactionId ${transactionId} is already processed.`,
      );
      // Already processed (Sislog retried) — respond 200 to stop retries
      return new Response("OK", { status: 200 });
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
    const monthsToAdd = payment.billing_cycle === "yearly"
      ? 12
      : payment.billing_cycle === "semiannual"
        ? 6
        : payment.billing_cycle === "quarterly"
          ? 3
          : 1;
    const today = new Date();
    const todayStr = today.toISOString().substring(0, 10);

    const addMonthsToDate = (date: Date, months: number): Date => {
      const result = new Date(date);
      const originalDay = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + months);
      const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
      result.setUTCDate(Math.min(originalDay, lastDay));
      return result;
    };

    let existingSubscription: any = null;
    if (payment.subscription_id) {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, start_date, end_date")
        .eq("id", payment.subscription_id)
        .maybeSingle();
      existingSubscription = data;
    }

    if (!existingSubscription) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, start_date, end_date")
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
    const newEnd = addMonthsToDate(isActivePeriod ? currentEnd! : todayStart, monthsToAdd);
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
          plan_name: payment.plan_name,
          billing_cycle: payment.billing_cycle,
          amount: payment.amount,
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

    // 3. Send confirmation email
    try {
      console.log(
        `[SislogWebhook] Querying company owner email for company: ${payment.company_id}`,
      );
      const { data: companyUser, error: ownerError } = await supabase
        .from("company_users")
        .select("profiles ( email, full_name ), companies ( name )")
        .eq("company_id", payment.company_id)
        .eq("role", "owner")
        .single();

      if (ownerError) {
        console.warn(
          "[SislogWebhook] Failed to query company owner for confirmation email:",
          ownerError,
        );
      }

      if (companyUser?.profiles && (companyUser.profiles as any).email) {
        const userEmail = (companyUser.profiles as any).email;
        const userName =
          (companyUser.profiles as any).full_name || "Estimado(a) Cliente";
        const companyName =
          (companyUser.companies as any)?.name || "sua empresa";

        console.log(
          `[SislogWebhook] Sending active subscription email to owner: ${userEmail}`,
        );

        const transporter = nodemailer.createTransport({
          host: "mail.ispcfacil.co.mz",
          port: 465,
          secure: true,
          auth: { user: "notifications@ispcfacil.co.mz", pass: "&fF1;s*QJ$dJ" },
        });

        const amountMZN = Number(payment.amount).toLocaleString("pt-MZ", {
          minimumFractionDigits: 2,
        });
        const cycleLabel =
          payment.billing_cycle === "yearly"
            ? "Anual (1 Ano)"
            : payment.billing_cycle === "semiannual"
            ? "Semestral (6 Meses)"
            : payment.billing_cycle === "quarterly"
            ? "Trimestral (3 Meses)"
            : "Mensal (1 Mês)";

        const htmlContent = `
          <div style="font-family:sans-serif;padding:24px;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:10px;">
            <h2 style="color:#f16c39;border-bottom:2px solid #f16c39;padding-bottom:10px;">✅ Confirmação de Pagamento de Subscrição</h2>
            <p>Olá <strong>${userName}</strong>,</p>
            <p>Confirmamos a receção do pagamento da subscrição para a empresa <strong>${companyName}</strong> no ISPC Fácil. A sua subscrição já está activa!</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;width:160px;">Plano:</td><td style="padding:8px;border-bottom:1px solid #eee;">${
                payment.plan_name
              }</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Ciclo:</td><td style="padding:8px;border-bottom:1px solid #eee;">${cycleLabel}</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Valor:</td><td style="padding:8px;border-bottom:1px solid #eee;">${amountMZN} MT</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Método:</td><td style="padding:8px;border-bottom:1px solid #eee;">${
                payment.payment_method?.toUpperCase() || provider
              } (${payment.phone_number || ""})</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Referência Sislog:</td><td style="padding:8px;border-bottom:1px solid #eee;">${
                reference || transactionId
              }</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Próxima Faturação:</td><td style="padding:8px;border-bottom:1px solid #eee;">${nextBillingDate.toLocaleDateString(
                "pt-PT",
              )}</td></tr>
            </table>
            <p>Agradecemos a sua preferência. Pode continuar a utilizar todas as funcionalidades sem interrupções.</p>
            <hr style="border:none;border-top:1px solid #eee;margin-top:24px;"/>
            <p style="font-size:11px;color:#888;">E-mail automático do ISPC Fácil. Não responda a este e-mail.</p>
          </div>`;

        await transporter.sendMail({
          from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
          to: userEmail,
          cc: "info@ispcfacil.com",
          subject:
            "✅ [ISPC Fácil] Subscrição Activada – Confirmação de Pagamento",
          html: htmlContent,
        });

        console.log(
          "[SislogWebhook] Confirmation email successfully sent to:",
          userEmail,
        );
      } else {
        console.warn(
          "[SislogWebhook] No owner profile email found. Skipping confirmation email.",
        );
      }
    } catch (emailErr) {
      console.error(
        "[SislogWebhook] Erro ao enviar email de confirmação:",
        emailErr,
      );
      // Don't fail the webhook — email is non-critical
    }

    // Must return 200 so Sislog considers the notification delivered
    return new Response("OK", { status: 200 });
  } catch (error: any) {
    console.error("[SislogWebhook] Error processing Sislog webhook:", error);
    // Return 500 → Sislog will retry every 5 min up to 5 times
    return new Response("Internal Server Error", { status: 500 });
  }
});
