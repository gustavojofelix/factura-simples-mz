import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import nodemailer from "npm:nodemailer@6.9.11";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SISLOG_URL     = "https://lin4.sislog.com/mobile/reference/request";
const SISLOG_USER    = "ISPCF";
const SISLOG_API_KEY = "8525efc3fc7843a2fa32e94fd656d1dd";

const SMTP_HOST    = "mail.ispcfacil.co.mz";
const SMTP_PORT    = 465;
const SMTP_USER    = "notifications@ispcfacil.co.mz";
const SMTP_PASS    = "&fF1;s*QJ$dJ";
const FROM_ADDRESS = '"ISPC Fácil" <notifications@ispcfacil.co.mz>';
const ADMIN_EMAIL  = "info@ispcfacil.com";

/** Send subscription confirmation email to the user and a copy to the admin. */
async function sendSubscriptionEmail(opts: {
  toEmail: string;
  planName: string;
  billingCycle: string;
  amount: number;
  currency: string;
  phoneNumber: string;
  paymentMethod: string;
  referenceCode: string;
}) {
  const cycleLabels: Record<string, string> = {
    monthly:    'Mensal',
    quarterly:  'Trimestral (3 meses)',
    semiannual: 'Semestral (6 meses)',
    yearly:     'Anual',
  };
  const cycleLabel      = cycleLabels[opts.billingCycle] || opts.billingCycle;
  const methodLabel     = opts.paymentMethod.toUpperCase();
  const amountFormatted = new Intl.NumberFormat('pt-MZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(opts.amount);

  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: true,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });

  const htmlUser = `
    <div style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 10px;">Confirmação de Subscrição</h2>
      <p>Olá,</p>
      <p>O seu pedido de pagamento para a subscrição do <strong>Plano ${opts.planName}</strong> foi enviado com sucesso. Por favor, verifique o seu telemóvel e introduza o PIN ${methodLabel} para confirmar.</p>
      <table style="width:100%; border-collapse:collapse; margin:20px 0;">
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold; width:160px;">Plano:</td><td style="padding:8px; border-bottom:1px solid #eee;">${opts.planName}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Período:</td><td style="padding:8px; border-bottom:1px solid #eee;">${cycleLabel}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Valor:</td><td style="padding:8px; border-bottom:1px solid #eee;">${amountFormatted} ${opts.currency}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Método:</td><td style="padding:8px; border-bottom:1px solid #eee;">${methodLabel}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Telemóvel:</td><td style="padding:8px; border-bottom:1px solid #eee;">${opts.phoneNumber}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Referência:</td><td style="padding:8px; border-bottom:1px solid #eee; font-family:monospace;">${opts.referenceCode}</td></tr>
        <tr><td style="padding:8px; font-weight:bold;">Data:</td><td style="padding:8px;">${new Date().toLocaleString('pt-PT')}</td></tr>
      </table>
      <p style="color:#555;">Caso não reconheça este pedido, contacte-nos em <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a>.</p>
      <hr style="border:none; border-top:1px solid #eee; margin-top:30px;"/>
      <p style="font-size:11px; color:#888;">E-mail automático do sistema ISPC Fácil. Não responda a este e-mail.</p>
    </div>
  `;

  const htmlAdmin = `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 10px;">Nova Subscrição Submetida</h2>
      <table style="width:100%; border-collapse:collapse; margin:20px 0;">
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold; width:160px;">Cliente:</td><td style="padding:8px; border-bottom:1px solid #eee;">${opts.toEmail}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Plano:</td><td style="padding:8px; border-bottom:1px solid #eee;">${opts.planName}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Período:</td><td style="padding:8px; border-bottom:1px solid #eee;">${cycleLabel}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Valor:</td><td style="padding:8px; border-bottom:1px solid #eee;">${amountFormatted} ${opts.currency}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Método:</td><td style="padding:8px; border-bottom:1px solid #eee;">${methodLabel}</td></tr>
        <tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">Telemóvel:</td><td style="padding:8px; border-bottom:1px solid #eee;">${opts.phoneNumber}</td></tr>
        <tr><td style="padding:8px; font-weight:bold;">Referência:</td><td style="padding:8px; font-family:monospace;">${opts.referenceCode}</td></tr>
      </table>
      <hr style="border:none; border-top:1px solid #eee; margin-top:30px;"/>
      <p style="font-size:11px; color:#888;">Sistema de notificações ISPC Fácil.</p>
    </div>
  `;

  // Send to subscriber
  await transporter.sendMail({
    from:    FROM_ADDRESS,
    to:      opts.toEmail,
    subject: `[ISPC Fácil] Confirmação de Subscrição – Plano ${opts.planName}`,
    html:    htmlUser,
  });

  // Send admin copy
  await transporter.sendMail({
    from:    FROM_ADDRESS,
    to:      ADMIN_EMAIL,
    subject: `[Notificação] Nova Subscrição – ${opts.planName} – ${opts.toEmail}`,
    html:    htmlAdmin,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      companyId,
      subscriptionId,
      planName     = 'Standard',
      billingCycle = 'monthly',
      amount       = 7500,
      paymentMethod,
      phoneNumber,
      userEmail    = '',
    } = await req.json();

    if (!companyId || !phoneNumber || !paymentMethod) {
      return new Response(
        JSON.stringify({ success: false, error: "Parâmetros de pagamento em falta (empresa, telefone ou método)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // ── Normalize phone number ──────────────────────────────────────────────
    // Sislog requires full number with country code: e.g. 25884xxxxxxx
    let cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
    if (!cleanPhone.startsWith('258') && cleanPhone.length === 9) {
      cleanPhone = '258' + cleanPhone;
    }

    // ── Generate transactionId (max 22 alphanumeric chars per Sislog docs) ──
    const uuid          = crypto.randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase();
    const ts            = Date.now().toString().slice(-9);
    const referenceCode = `S${ts}${uuid}`;  // 19 chars — well within 22 char limit

    // ── Value format: 2 decimal places, no comma or point ──────────────────
    // e.g. 7500.00 MZN → "750000"
    const sislogValue = Math.round(Number(amount) * 100).toString();

    // ── Deadline: 3 days from today (yyyymmdd) ──────────────────────────────
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + 3);
    const deadlineStr = deadlineDate.toISOString().replace(/-/g, '').slice(0, 8);

    // ── Sislog request payload ───────────────────────────────────────────────
    const sislogPayload: Record<string, string> = {
      username:      SISLOG_USER,
      transactionId: referenceCode,
      value:         sislogValue,
      deadline:      deadlineStr,
      cel:           cleanPhone,
    };

    let sislogResult: any = {};
    let sislogOk = true;

    try {
      const sislogResponse = await fetch(SISLOG_URL, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'apikey':       SISLOG_API_KEY,
        },
        body: JSON.stringify(sislogPayload),
      });

      const responseText = await sislogResponse.text();
      try {
        sislogResult = JSON.parse(responseText);
      } catch {
        sislogResult = { rawResponse: responseText };
      }

      console.log('=> SISLOG payload:',  JSON.stringify(sislogPayload));
      console.log('=> SISLOG response:', JSON.stringify(sislogResult));

      if (
        sislogResult.status?.toLowerCase() === 'invalid' ||
        !sislogResponse.ok
      ) {
        sislogOk = false;
        const sislogError = sislogResult.errorMessage || `HTTP ${sislogResponse.status}`;
        console.error('Sislog returned error:', sislogError);
        sislogResult._errorMessage = sislogError;
      }
    } catch (err: any) {
      console.error("Erro na comunicação com Sislog:", err);
      sislogResult = { error: err.message || "Falha de ligação ao WebService da Sislog" };
      sislogOk = false;
    }

    // ── Persist payment record to Supabase ───────────────────────────────────
    const supabaseUrl        = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase           = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from('subscription_payments').insert({
      subscription_id: subscriptionId || null,
      company_id:      companyId,
      plan_name:       planName,
      billing_cycle:   billingCycle,
      amount:          amount,
      currency:        'MZN',
      payment_method:  paymentMethod,
      phone_number:    phoneNumber,
      reference_code:  referenceCode,
      status:          sislogOk ? 'pending' : 'failed',
      sislog_response: sislogResult,
    });

    // ── Return error if Sislog rejected ──────────────────────────────────────
    if (!sislogOk) {
      return new Response(
        JSON.stringify({
          success:        false,
          error:          sislogResult._errorMessage || sislogResult.errorMessage || "A Sislog rejeitou o pedido. Verifique as credenciais.",
          sislogResponse: sislogResult,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── Success ──────────────────────────────────────────────────────────────

    const entity    = sislogResult.entity    || null;
    const reference = sislogResult.reference || null;

    return new Response(
      JSON.stringify({
        success:        true,
        referenceCode,
        status:         'pending',
        pushSent:       true,
        message:        `Pedido enviado para ${phoneNumber}. Verifique o seu telemóvel e introduza o PIN ${paymentMethod.toUpperCase()} para confirmar o pagamento.`,
        sislogResponse: sislogResult,
        paymentDetails: { entity, reference, amount, phoneNumber },
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
