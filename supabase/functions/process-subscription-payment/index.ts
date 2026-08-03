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
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + 3); // 3 days deadline
    const deadlineStr = deadlineDate.toISOString().replace(/-/g, '').slice(0, 8); // YYYYMMDD

    const sislogPayload = {
      username: SISLOG_USER,
      transactionId: referenceCode,
      value: (Number(amount) * 100).toString(),
      deadline: deadlineStr
    };

    let sislogResult: any = {};
    let sislogOk = true;
    let errorMessage = "";

    try {
      const response = await fetch(SISLOG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'apikey': SISLOG_API_KEY
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
      status: 'pending', // Waiting for webhook confirmation
      sislog_response: sislogResult
    });

    const entity = sislogResult.entity || sislogResult.Entity;
    const reference = sislogResult.reference || sislogResult.Reference;

    return new Response(
      JSON.stringify({
        success: true,
        referenceCode,
        status: 'pending',
        message: `Pedido de pagamento ${serviceCode} iniciado. Por favor, efetue o pagamento utilizando a Entidade ${entity || 'N/A'} e Referência ${reference || 'N/A'}.`,
        sislogResponse: sislogResult,
        paymentDetails: {
          entity,
          reference,
          amount
        }
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
