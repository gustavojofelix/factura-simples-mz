import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.11";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, email, fullName, phone } = await req.json();

    if (!email) {
      throw new Error("Email is required");
    }

    const transporter = nodemailer.createTransport({
       host: "mail.ispcfacil.co.mz",
       port: 465,
       secure: true,
       auth: {
         user: "notifications@ispcfacil.co.mz",
         pass: "&fF1;s*QJ$dJ",
       },
    });

    const isInvite = type === 'invite';
    const actionText = isInvite ? 'convidado para a plataforma' : 'registado na plataforma';
    const subject = isInvite ? `[Notificação] Novo Utilizador Convidado - ISPC Fácil` : `[Notificação] Novo Registo de Conta - ISPC Fácil`;

    const htmlContent = `
      <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 10px;">Notificação de Sistema</h2>
        <p>Olá Administrador,</p>
        <p>Um novo utilizador foi <strong>${actionText}</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 120px;">Email:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Nome Completo:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${fullName || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Telefone:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${phone || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Data/Hora:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date().toLocaleString('pt-PT')}</td>
          </tr>
        </table>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;"/>
        <p style="font-size: 11px; color: #888;">Este é um e-mail automático do sistema de notificações do ISPC Fácil.</p>
      </div>
    `;

    const mailOptions = {
      from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
      to: 'info@ispcfacil.com',
      subject: subject,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Failed to send notification email:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
