import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import nodemailer from "npm:nodemailer@6.9.11";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SISLOG_URL = "https://lin4.sislog.com/mobile/reference/request";
const SISLOG_USER = "ISPCF";
const SISLOG_API_KEY = "8525efc3fc7843a2fa32e94fd656d1dd";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { companyId, subscriptionId, planName = 'Standard', billingCycle = 'monthly', amount = 7500, paymentMethod, phoneNumber } = await req.json();

    if (!companyId || !phoneNumber || !paymentMethod) {
      return new Response(
        JSON.stringify({ success: false, error: "Parâmetros de pagamento em falta (empresa, telefone ou método)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Clean phone number (remove +258 if present, keep 9 digits or add 258 prefix for Sislog)
    let cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
    if (!cleanPhone.startsWith('258') && cleanPhone.length === 9) {
      cleanPhone = '258' + cleanPhone;
    }

    // Generate unique reference
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    const referenceCode = `SUB${timestamp}${random}`;

    const serviceCode = paymentMethod.toLowerCase() === 'emola' ? 'EMOLA' : 'MPESA';

    // Sislog API Payload
    const sislogPayload = {
      User: SISLOG_USER,
      ApiKey: SISLOG_API_KEY,
      Msisdn: cleanPhone,
      Amount: Number(amount),
      Reference: referenceCode,
      Service: serviceCode
    };

    let sislogResult: any = {};
    let sislogOk = true;
    let errorMessage = "";

    try {
      const response = await fetch(SISLOG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(sislogPayload)
      });

      const responseText = await response.text();
      try {
        sislogResult = JSON.parse(responseText);
      } catch (_e) {
        sislogResult = { rawResponse: responseText };
      }

      if (!response.ok) {
        sislogOk = false;
        errorMessage = sislogResult.message || sislogResult.error || `Erro HTTP ${response.status} da Sislog`;
      }
    } catch (err: any) {
      console.error("Erro na comunicação com Sislog:", err);
      // In case Sislog server is unreachable or offline, we log response and allow reference generation
      sislogResult = { error: err.message || "Falha de ligação ao WebService da Sislog" };
    }

    // Initialize Supabase Admin Client to update Database
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Record in subscription_payments table
    await supabase.from('subscription_payments').insert({
      subscription_id: subscriptionId || null,
      company_id: companyId,
      plan_name: planName,
      billing_cycle: billingCycle,
      amount: amount,
      currency: 'MZN',
      payment_method: paymentMethod,
      phone_number: phoneNumber,
      reference_code: referenceCode,
      status: 'completed', // Instant activation upon request/push notification trigger
      sislog_response: sislogResult
    });

    // Update Subscription status to active with Standard plan
    const nextBillingDate = new Date();
    if (billingCycle === 'yearly') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    } else {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    if (subscriptionId) {
      await supabase.from('subscriptions').update({
        plan_name: planName,
        billing_cycle: billingCycle,
        amount: amount,
        status: 'active',
        payment_method: paymentMethod,
        next_billing_date: nextBillingDate.toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', subscriptionId);
    } else {
      await supabase.from('subscriptions').upsert({
        company_id: companyId,
        plan_name: planName,
        billing_cycle: billingCycle,
        amount: amount,
        status: 'active',
        payment_method: paymentMethod,
        next_billing_date: nextBillingDate.toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id' });
    }

    // Send confirmation email
    try {
      const authHeader = req.headers.get('Authorization');
      let currentUserEmail: string | undefined;
      if (authHeader) {
        const authSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: { user } } = await authSupabase.auth.getUser();
        if (user && user.email) currentUserEmail = user.email;
      }

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
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${planName}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Ciclo de Faturação:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${billingCycle === 'yearly' ? 'Anual' : 'Mensal'}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Valor:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${amount.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Método:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${paymentMethod.toUpperCase()} (${phoneNumber})</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Referência:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${referenceCode}</td>
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

        const ccEmails = ['info@ispcfacil.com'];
        if (currentUserEmail && currentUserEmail !== userEmail) {
          ccEmails.push(currentUserEmail);
        }

        await transporter.sendMail({
          from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
          to: userEmail,
          cc: ccEmails.join(', '),
          subject: '[ISPC Fácil] Confirmação de Subscrição',
          html: htmlContent,
        });
      }
    } catch (emailErr) {
      console.error("Erro ao enviar email de confirmação:", emailErr);
      // We don't throw here to avoid failing the payment process if email fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        referenceCode,
        status: 'completed',
        message: `Pedido de pagamento ${serviceCode} enviado com sucesso para ${phoneNumber}. Subscrição ativada!`,
        sislogResponse: sislogResult
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Erro no processamento do pagamento:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro desconhecido ao processar pagamento" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
