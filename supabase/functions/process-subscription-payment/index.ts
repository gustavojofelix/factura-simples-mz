import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

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
