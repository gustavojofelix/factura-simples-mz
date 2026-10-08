import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.11"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // 0. Quem está a convidar? Só o proprietário da empresa (ou um administrador
    //    da plataforma, no Back Office) pode criar contas e enviar convites.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: callerData, error: callerError } = await supabaseClient.auth.getUser(jwt)
    const caller = callerData?.user
    if (callerError || !caller) {
      throw new HttpError(401, 'Sessão inválida. Entre novamente no sistema.', 'UNAUTHENTICATED')
    }

    const { email, fullName, phone, companyId, companyName, role, inviterName, isPlatformAdmin } = await req.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      throw new HttpError(400, 'Indique um endereço de email válido.', 'INVALID_EMAIL')
    }

    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()
    const callerIsPlatformAdmin = callerProfile?.role === 'admin'

    if (isPlatformAdmin) {
      if (!callerIsPlatformAdmin) {
        throw new HttpError(403, 'Apenas administradores da plataforma podem convidar administradores.', 'FORBIDDEN')
      }
    } else {
      if (!companyId) {
        throw new HttpError(400, 'Empresa não indicada.', 'COMPANY_REQUIRED')
      }
      const { data: company } = await supabaseClient
        .from('companies')
        .select('user_id')
        .eq('id', companyId)
        .maybeSingle()
      if (!company) {
        throw new HttpError(404, 'Empresa não encontrada.', 'COMPANY_NOT_FOUND')
      }
      if (company.user_id !== caller.id && !callerIsPlatformAdmin) {
        throw new HttpError(403, 'Apenas o proprietário da empresa pode adicionar utilizadores.', 'FORBIDDEN')
      }
    }

    // 1. Validar o SMTP ANTES de criar contas: antes, a conta era criada e o
    //    convite nunca chegava, deixando o utilizador sem forma de definir senha.
    const smtpHost = Deno.env.get("SMTP_HOST")
    const smtpUser = Deno.env.get("SMTP_USER")
    const smtpPass = Deno.env.get("SMTP_PASS")
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465")

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new HttpError(
        503,
        'O serviço de e-mail da plataforma não está configurado, por isso não é possível enviar o convite. Contacte o suporte do ISPC Fácil.',
        'SMTP_CONFIG_MISSING',
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://ispcfacil.co.mz'
    const redirectTo = `${siteUrl}/#/resetar-senha`
    let actionLink = `${siteUrl}/#/entrar`
    let needsPassword = false
    let isNewUser = false
    let targetUserId: string | null = null

    // 2. O utilizador já existe?
    const { data: existingProfile } = await supabaseClient
      .from('profiles')
      .select('id, full_name, phone')
      .ilike('email', cleanEmail)
      .maybeSingle()

    if (existingProfile?.id) {
      targetUserId = existingProfile.id
      // Conta criada por um convite anterior que nunca foi aceite: enviar link para definir senha.
      const { data: authUser } = await supabaseClient.auth.admin.getUserById(existingProfile.id)
      needsPassword = !!authUser?.user && !authUser.user.last_sign_in_at
    } else {
      const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
        type: 'invite',
        email: cleanEmail,
        data: { full_name: fullName, phone },
        options: { redirectTo },
      })

      if (!linkError && linkData?.properties?.action_link) {
        actionLink = linkData.properties.action_link
        targetUserId = linkData.user?.id || null
        isNewUser = true
      } else {
        // Já existe em auth.users mas sem perfil (ex.: convite anterior falhado).
        console.log('generateLink invite falhou, a tentar recovery:', linkError?.message)
        needsPassword = true
      }
    }

    if (needsPassword) {
      const { data: recoveryData, error: recoveryError } = await supabaseClient.auth.admin.generateLink({
        type: 'recovery',
        email: cleanEmail,
        options: { redirectTo },
      })
      if (recoveryError || !recoveryData?.properties?.action_link) {
        throw new HttpError(500, 'Não foi possível gerar o link de acesso para este email.', 'LINK_FAILED')
      }
      actionLink = recoveryData.properties.action_link
      targetUserId = targetUserId || recoveryData.user?.id || null
      isNewUser = true
    }

    if (!targetUserId) {
      throw new HttpError(500, 'Não foi possível criar a conta do utilizador.', 'USER_CREATE_FAILED')
    }

    // 3. Nome/telefone no perfil (o cliente não pode escrever no perfil de outro utilizador).
    if (fullName || phone) {
      const profileUpdate: Record<string, unknown> = { id: targetUserId, email: cleanEmail }
      if (fullName && !existingProfile?.full_name) profileUpdate.full_name = fullName
      if (phone && !existingProfile?.phone) profileUpdate.phone = phone
      const { error: profileError } = await supabaseClient.from('profiles').upsert(profileUpdate)
      if (profileError) console.warn('Não foi possível actualizar o perfil:', profileError.message)
    }

    // 4. Enviar o email
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    })

    const roleName = escapeHtml(role || 'Membro')
    const inviter = escapeHtml(inviterName || 'Um administrador')
    const company = escapeHtml(companyName || 'uma empresa')
    const greetingName = escapeHtml(fullName || existingProfile?.full_name || cleanEmail)
    const safeLink = escapeHtml(actionLink)

    let titleText = ''
    let bodyText = ''

    if (isPlatformAdmin) {
      titleText = isNewUser ? 'Convite para aceder ao Back Office' : 'Adicionado ao Back Office'
      bodyText = isNewUser
        ? `<strong>${inviter}</strong> adicionou-o(a) como <strong>${roleName}</strong> no Back Office do ISPC Fácil.`
        : `A sua conta foi configurada com acesso de <strong>${roleName}</strong> no Back Office do ISPC Fácil.`
    } else {
      titleText = isNewUser ? `Convite para aceder à empresa ${company}` : `Adicionado à empresa ${company}`
      bodyText = `<strong>${inviter}</strong> adicionou-o(a) à empresa <strong>${company}</strong> no ISPC Fácil com o papel de <strong>${roleName}</strong>.`
    }

    const buttonText = isNewUser ? 'Aceitar Convite & Criar Senha' : 'Aceder ao ISPC Fácil'

    const htmlContent = `
      <div style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 12px; margin-top: 0;">✅ ${titleText}</h2>
        <p style="font-size: 15px; color: #333;">Olá <strong>${greetingName}</strong>,</p>
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
          <a href="${safeLink}" style="background-color: #f16c39; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">${buttonText}</a>
        </div>
        <p style="font-size: 12px; color: #777;">Se o botão não funcionar, copie e cole o seguinte link no seu navegador:</p>
        <p style="word-break: break-all; font-size: 11px; color: #999;">${safeLink}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 32px;"/>
        <p style="font-size: 11px; color: #aaa; text-align: center;">Este é um e-mail automático do sistema ISPC Fácil. Não responda a esta mensagem.</p>
      </div>
    `

    try {
      await transporter.sendMail({
        from: `"ISPC Fácil" <${Deno.env.get("SMTP_FROM_EMAIL") ?? smtpUser}>`,
        to: cleanEmail,
        subject: `[ISPC Fácil] ${titleText.replace(/&amp;/g, '&')}`,
        html: htmlContent,
      })
    } catch (mailError) {
      console.error('Falha ao enviar convite:', mailError)
      // A conta existe; devolvemos o id para o acesso ser criado, mas avisamos.
      return jsonResponse({
        success: true,
        emailSent: false,
        warning: 'O acesso foi criado, mas o email de convite não pôde ser enviado. Peça ao utilizador para usar "Esqueci a senha" no ecrã de entrada.',
        user: { id: targetUserId, email: cleanEmail },
      })
    }

    return jsonResponse({
      success: true,
      emailSent: true,
      isNewUser,
      user: { id: targetUserId, email: cleanEmail },
    })
  } catch (error: any) {
    console.error('Error in invite-user function:', error)
    const status = error instanceof HttpError ? error.status : 400
    return jsonResponse({ error: error.message, code: error?.code }, status)
  }
})
