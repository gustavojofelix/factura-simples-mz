import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.11"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { email, fullName, phone, companyName, role, inviterName } = await req.json()

    if (!email) {
      throw new Error('Email is required')
    }

    // Gerar o link de convite manualmente
    const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:4200'
    const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
      type: 'invite',
      email: email,
      data: {
        full_name: fullName,
        phone: phone,
      },
      options: {
        redirectTo: `${siteUrl}/#/resetar-senha`
      }
    })

    if (linkError) throw linkError

    // Enviar e-mail de convite usando Nodemailer
    const transporter = nodemailer.createTransport({
       host: "mail.ispcfacil.co.mz",
       port: 465,
       secure: true,
       auth: {
         user: "notifications@ispcfacil.co.mz",
         pass: "&fF1;s*QJ$dJ",
       },
    })

    const roleName = role || 'Membro'
    const inviter = inviterName || 'Um administrador'
    const company = companyName || 'uma empresa'

    const htmlContent = `
      <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 10px;">Convite para ISPC Fácil</h2>
        <p>Olá ${fullName || 'Utilizador'},</p>
        <p><strong>${inviter}</strong> convidou-o para aceder à empresa <strong>${company}</strong> no ISPC Fácil com o nível de acesso: <strong>${roleName}</strong>.</p>
        <p>Para aceitar o convite e definir a sua palavra-passe, clique no botão abaixo:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${linkData.properties.action_link}" style="background-color: #f16c39; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Aceitar Convite</a>
        </div>
        <p>Se o botão não funcionar, copie e cole o seguinte link no seu navegador:</p>
        <p style="word-break: break-all; font-size: 12px; color: #555;">${linkData.properties.action_link}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;"/>
        <p style="font-size: 11px; color: #888;">Este é um e-mail automático do sistema ISPC Fácil.</p>
      </div>
    `

    const mailOptions = {
      from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
      to: email,
      subject: `Convite para acesso à empresa ${company} - ISPC Fácil`,
      html: htmlContent,
    }

    await transporter.sendMail(mailOptions)

    // Notify the admin of the invitation
    try {
      const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-admin`;
      await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          type: 'invite',
          email,
          fullName,
          phone
        })
      });
    } catch (notifyError) {
      console.error('Failed to notify admin of user invitation:', notifyError);
    }

    return new Response(
      JSON.stringify({ user: linkData.user }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
