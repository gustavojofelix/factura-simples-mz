import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import nodemailer from "npm:nodemailer@6.9.11";

serve(async (req) => {
  // It's a GET request from Sislog
  const url = new URL(req.url);
  const entity = url.searchParams.get('entity');
  const reference = url.searchParams.get('reference');
  const value = url.searchParams.get('value');
  const transactionId = url.searchParams.get('transactionId');
  const provider = url.searchParams.get('provider');
  const paymentdatetime = url.searchParams.get('paymentdatetime');

  if (!transactionId) {
    return new Response("Missing transactionId", { status: 400 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get the payment request
    const { data: payment, error: paymentError } = await supabase
      .from('subscription_payments')
      .select('*')
      .eq('reference_code', transactionId)
      .single();

    if (paymentError || !payment) {
      return new Response("Payment not found", { status: 404 });
    }

    if (payment.status === 'completed') {
      return new Response("Payment already processed", { status: 200 });
    }

    // 2. Update payment status
    await supabase
      .from('subscription_payments')
      .update({ status: 'completed' })
      .eq('id', payment.id);

    const companyId = payment.company_id;

    // 3. Update subscription to active
    const nextBillingDate = new Date();
    if (payment.billing_cycle === 'yearly') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    } else {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    if (payment.subscription_id) {
      await supabase.from('subscriptions').update({
        plan_name: payment.plan_name,
        billing_cycle: payment.billing_cycle,
        amount: payment.amount,
        status: 'active',
        payment_method: payment.payment_method,
        next_billing_date: nextBillingDate.toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', payment.subscription_id);
    } else {
      await supabase.from('subscriptions').upsert({
        company_id: companyId,
        plan_name: payment.plan_name,
        billing_cycle: payment.billing_cycle,
        amount: payment.amount,
        status: 'active',
        payment_method: payment.payment_method,
        next_billing_date: nextBillingDate.toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id' });
    }

    // 4. Send email confirmation
    const { data: companyUser } = await supabase
        .from('company_users')
        .select(`
          profiles ( email, full_name ),
          companies ( name )
        `)
        .eq('company_id', companyId)
        .eq('role', 'owner')
        .single();
        
    if (companyUser && companyUser.profiles && (companyUser.profiles as any).email) {
      const userEmail = (companyUser.profiles as any).email;
      const userName = (companyUser.profiles as any).full_name || 'Estimado(a) Cliente';
      const companyName = (companyUser.companies as any)?.name || 'sua empresa';

      const transporter = nodemailer.createTransport({
         host: "mail.ispcfacil.co.mz",
         port: 465,
         secure: true,
         auth: {
           user: "notifications@ispcfacil.co.mz",
           pass: "&fF1;s*QJ$dJ",
         },
      });

      const htmlContent = `
        <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 10px;">Confirmação de Pagamento de Subscrição</h2>
          <p>Olá <strong>${userName}</strong>,</p>
          <p>Confirmamos a receção do pagamento da subscrição para a empresa <strong>${companyName}</strong> no ISPC Fácil.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 150px;">Plano:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${payment.plan_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Ciclo de Faturação:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${payment.billing_cycle === 'yearly' ? 'Anual' : 'Mensal'}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Valor:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${Number(payment.amount).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Método:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${payment.payment_method?.toUpperCase() || provider} (${payment.phone_number || ''})</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Referência:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${transactionId}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Próxima Faturação:</td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${nextBillingDate.toLocaleDateString('pt-PT')}</td>
            </tr>
          </table>
          <p>Agradecemos a sua preferência. A sua subscrição encontra-se ativa e pode continuar a utilizar todas as funcionalidades sem interrupções.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;"/>
          <p style="font-size: 11px; color: #888;">Este é um e-mail automático do ISPC Fácil. Por favor, não responda a este e-mail.</p>
        </div>
      `;

      await transporter.sendMail({
        from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
        to: userEmail,
        cc: 'info@ispcfacil.com',
        subject: '[ISPC Fácil] Confirmação de Subscrição',
        html: htmlContent,
      });
    }

    // 5. Must return 200 OK so Sislog knows we received it
    return new Response("OK", { status: 200 });

  } catch (error: any) {
    console.error("Error processing webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
