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

    const { email, fullName, phone, companyName, role, inviterName, isPlatformAdmin } = await req.json()

    if (!email) {
      throw new Error('Email is required')
    }

    const cleanEmail = email.trim().toLowerCase()
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://ispcfacil.co.mz'
    let actionLink = `${siteUrl}/#/entrar`
    let isNewUser = false
    let targetUserId: string | null = null

    // 1. Check if user already exists in auth or profiles
    const { data: existingProfile } = await supabaseClient
      .from('profiles')
      .select('id, full_name')
      .ilike('email', cleanEmail)
      .maybeSingle()

    if (existingProfile?.id) {
      targetUserId = existingProfile.id
    }

    // 2. Try to generate an invite link if user is not in profiles
    if (!targetUserId) {
      try {
        const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
          type: 'invite',
          email: cleanEmail,
          data: {
            full_name: fullName,
            phone: phone,
          },
          options: {
            redirectTo: `${siteUrl}/#/resetar-senha`
          }
        })

        if (!linkError && linkData?.properties?.action_link) {
          actionLink = linkData.properties.action_link
          targetUserId = linkData.user?.id || null
          isNewUser = true
        }
      } catch (e) {
        console.log('User might already exist in auth:', e)
      }
    }

    // Send email notification/invite using Nodemailer
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

    let titleText = '';
    let bodyText = '';

    if (isPlatformAdmin) {
      titleText = isNewUser 
        ? 'Convite para aceder ao Back Office' 
        : 'Adicionado ao Back Office';
      bodyText = isNewUser
        ? `<strong>${inviter}</strong> adicionou-o(a) como <strong>${roleName}</strong> no Back Office do ISPC Fácil.`
        : `A sua conta foi configurada com acesso de <strong>${roleName}</strong> no Back Office do ISPC Fácil.`;
    } else {
      titleText = isNewUser
        ? `Convite para aceder à empresa ${company}`
        : `Adicionado à empresa ${company}`;
      bodyText = `<strong>${inviter}</strong> adicionou-o(a) à empresa <strong>${company}</strong> no ISPC Fácil com o papel de <strong>${roleName}</strong>.`;
    }

    const buttonText = isNewUser ? 'Aceitar Convite & Criar Senha' : 'Aceder ao ISPC Fácil'

    const htmlContent = `
      <div style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 12px; margin-top: 0;">✅ ${titleText}</h2>
        <p style="font-size: 15px; color: #333;">Olá <strong>${fullName || cleanEmail}</strong>,</p>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          ${bodyText}
        </p>
        ${isNewUser ? `
          <p style="font-size: 14px; color: #555; line-height: 1.6;">
            Para aceitar o convite e definir a sua palavra-passe de acesso, clique no botão abaixo:
          </p>
        ` : `
          <p style="font-size: 14px; color: #555; line-height: 1.6;">
            A sua conta já tem acesso a esta secção. Clique no botão abaixo para iniciar sessão:
          </p>
        `}
        <div style="text-align: center; margin: 32px 0;">
          <a href="${actionLink}" style="background-color: #f16c39; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">${buttonText}</a>
        </div>
        <p style="font-size: 12px; color: #777;">Se o botão não funcionar, copie e cole o seguinte link no seu navegador:</p>
        <p style="word-break: break-all; font-size: 11px; color: #999;">${actionLink}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 32px;"/>
        <p style="font-size: 11px; color: #aaa; text-align: center;">Este é um e-mail automático do sistema ISPC Fácil. Não responda a esta mensagem.</p>
      </div>
    `

    const mailOptions = {
      from: '"ISPC Fácil" <notifications@ispcfacil.co.mz>',
      to: cleanEmail,
      subject: `[ISPC Fácil] ${titleText}`,
      html: htmlContent,
    }

    await transporter.sendMail(mailOptions)

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: targetUserId, email: cleanEmail }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error: any) {
    console.error('Error in invite-user function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
