import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import nodemailer from "npm:nodemailer@6.9.11";

// Sislog calls this endpoint via GET when a payment succeeds OR fails.
// Success:  entity != "00000"
// Failure:  entity == "00000", errormessage is set (Sislog API v1.3)

serve(async (req) => {
  // CORS support
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const params: Record<string, string> = {};

  // 1. Parse URL query parameters
  const url = new URL(req.url);
  url.searchParams.forEach((val, key) => {
    params[key.toLowerCase()] = val;
  });

  // 2. If POST request, attempt to read JSON body parameters
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body && typeof body === 'object') {
        Object.keys(body).forEach(key => {
          params[key.toLowerCase()] = String(body[key] ?? '');
        });
      }
    } catch (e) {
      // Ignore body parsing errors
    }
  }

  const entity          = params['entity']          || '';
  const reference       = params['reference']       || '';
  const value           = params['value']           || '0';
  const transactionId   = params['transactionid']   || params['transaction_id'] || '';
  const provider        = params['provider']        || '';
  const paymentdatetime = params['paymentdatetime'] || '';
  const errormessage    = params['errormessage']    || '';

  if (!transactionId) {
    console.warn("sislog-webhook called without transactionId. Params received:", params);
    return new Response("Missing transactionId", { 
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' } 
    });
  }


  const supabaseUrl        = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // ── Find the matching payment record ─────────────────────────────────────
    const { data: payment, error: paymentError } = await supabase
      .from('subscription_payments')
      .select('*')
      .eq('reference_code', transactionId)
      .single();

    if (paymentError || !payment) {
      console.error("Payment not found for transactionId:", transactionId);
      return new Response("Payment not found", { status: 404 });
    }

    // ── FAILED PAYMENT (Sislog v1.3) ─────────────────────────────────────────
    // When entity === "00000" the wallet returned an error (e.g. user cancelled / wrong PIN)
    if (entity === '00000') {
      const decodedError = decodeURIComponent(errormessage || 'Unknown error');
      console.warn(`Payment failed for ${transactionId}: ${decodedError}`);

      await supabase
        .from('subscription_payments')
        .update({
          status: 'failed',
          sislog_response: {
            ...payment.sislog_response,
            failureReason: decodedError,
            provider,
            failedAt: paymentdatetime,
          },
        })
        .eq('id', payment.id);

      // Must return 200 so Sislog stops retrying
      return new Response("OK", { status: 200 });
    }

    // ── SUCCESSFUL PAYMENT ───────────────────────────────────────────────────
    if (payment.status === 'completed') {
      // Already processed (Sislog retried) — respond 200 to stop retries
      return new Response("OK", { status: 200 });
    }

    // 1. Mark payment as completed
    await supabase
      .from('subscription_payments')
      .update({
        status: 'completed',
        sislog_response: {
          ...payment.sislog_response,
          entity,
          reference,
          value,
          provider,
          paymentdatetime,
        },
      })
      .eq('id', payment.id);

    // 2. Activate the subscription
    const nextBillingDate = new Date();
    if (payment.billing_cycle === 'yearly') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    } else if (payment.billing_cycle === 'semiannual') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 6);
    } else if (payment.billing_cycle === 'quarterly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
    } else {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    const startDateStr = new Date().toISOString().substring(0, 10);
    const nextBillingDateStr = nextBillingDate.toISOString().substring(0, 10);

    if (payment.subscription_id) {
      await supabase.from('subscriptions').update({
        plan_name:         payment.plan_name,
        billing_cycle:     payment.billing_cycle,
        amount:            payment.amount,
        status:            'active',
        payment_method:    payment.payment_method,
        start_date:        startDateStr,
        end_date:          nextBillingDateStr,
        next_billing_date: nextBillingDateStr,
        updated_at:        new Date().toISOString(),
      }).eq('id', payment.subscription_id);
    } else {
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('company_id', payment.company_id)
        .limit(1)
        .maybeSingle();

      if (existingSub?.id) {
        await supabase.from('subscriptions').update({
          plan_name:         payment.plan_name,
          billing_cycle:     payment.billing_cycle,
          amount:            payment.amount,
          status:            'active',
          payment_method:    payment.payment_method,
          start_date:        startDateStr,
          end_date:          nextBillingDateStr,
          next_billing_date: nextBillingDateStr,
          updated_at:        new Date().toISOString(),
        }).eq('id', existingSub.id);
      } else {
        await supabase.from('subscriptions').insert({
          company_id:        payment.company_id,
          plan_name:         payment.plan_name,
          billing_cycle:     payment.billing_cycle,
          amount:            payment.amount,
          status:            'active',
          payment_method:    payment.payment_method,
          start_date:        startDateStr,
          end_date:          nextBillingDateStr,
          next_billing_date: nextBillingDateStr,
          updated_at:        new Date().toISOString(),
        });
      }
    }

    // 3. Send confirmation email
    try {
      const { data: companyUser } = await supabase
        .from('company_users')
        .select('profiles ( email, full_name ), companies ( name )')
        .eq('company_id', payment.company_id)
        .eq('role', 'owner')
        .single();

      if (companyUser?.profiles && (companyUser.profiles as any).email) {
        const userEmail   = (companyUser.profiles as any).email;
        const userName    = (companyUser.profiles as any).full_name || 'Estimado(a) Cliente';
        const companyName = (companyUser.companies as any)?.name   || 'sua empresa';

        const transporter = nodemailer.createTransport({
          host:   "mail.ispcfacil.co.mz",
          port:   465,
          secure: true,
          auth:   { user: "notifications@ispcfacil.co.mz", pass: "&fF1;s*QJ$dJ" },
        });

        const amountMZN = (Number(payment.amount)).toLocaleString('pt-MZ', { minimumFractionDigits: 2 });
        const cycleLabel = payment.billing_cycle === 'yearly' ? 'Anual (1 Ano)' : payment.billing_cycle === 'semiannual' ? 'Semestral (6 Meses)' : payment.billing_cycle === 'quarterly' ? 'Trimestral (3 Meses)' : 'Mensal (1 Mês)';

        const htmlContent = `
          <div style="font-family:sans-serif;padding:24px;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:10px;">
            <h2 style="color:#f16c39;border-bottom:2px solid #f16c39;padding-bottom:10px;">✅ Confirmação de Pagamento de Subscrição</h2>
            <p>Olá <strong>${userName}</strong>,</p>
            <p>Confirmamos a receção do pagamento da subscrição para a empresa <strong>${companyName}</strong> no ISPC Fácil. A sua subscrição já está activa!</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;width:160px;">Plano:</td><td style="padding:8px;border-bottom:1px solid #eee;">${payment.plan_name}</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Ciclo:</td><td style="padding:8px;border-bottom:1px solid #eee;">${cycleLabel}</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Valor:</td><td style="padding:8px;border-bottom:1px solid #eee;">${amountMZN} MT</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Método:</td><td style="padding:8px;border-bottom:1px solid #eee;">${payment.payment_method?.toUpperCase() || provider} (${payment.phone_number || ''})</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Referência Sislog:</td><td style="padding:8px;border-bottom:1px solid #eee;">${reference || transactionId}</td></tr>
              <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Próxima Faturação:</td><td style="padding:8px;border-bottom:1px solid #eee;">${nextBillingDate.toLocaleDateString('pt-PT')}</td></tr>
            </table>
            <p>Agradecemos a sua preferência. Pode continuar a utilizar todas as funcionalidades sem interrupções.</p>
            <hr style="border:none;border-top:1px solid #eee;margin-top:24px;"/>
            <p style="font-size:11px;color:#888;">E-mail automático do ISPC Fácil. Não responda a este e-mail.</p>
          </div>`;

        await transporter.sendMail({
          from:    '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
          to:      userEmail,
          cc:      'info@ispcfacil.com',
          subject: '✅ [ISPC Fácil] Subscrição Activada – Confirmação de Pagamento',
          html:    htmlContent,
        });

        console.log("Confirmation email sent to:", userEmail);
      }
    } catch (emailErr) {
      console.error("Erro ao enviar email de confirmação:", emailErr);
      // Don't fail the webhook — email is non-critical
    }

    // Must return 200 so Sislog considers the notification delivered
    return new Response("OK", { status: 200 });

  } catch (error: any) {
    console.error("Error processing Sislog webhook:", error);
    // Return 500 → Sislog will retry every 5 min up to 5 times
    return new Response("Internal Server Error", { status: 500 });
  }
});
