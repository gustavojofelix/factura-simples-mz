import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.11"
import { accountUrlForCompany, siteUrl as rootSiteUrl } from "../_shared/account-url.ts"
import { type EmailLanguage, getUserLanguage, htmlLang, type Localized, normalizeLanguage, pick } from "../_shared/i18n.ts"

// Língua do e-mail de convite: a do convidado (se já tiver perfil com língua),
// senão `language` do pedido (língua da interface de quem convida), senão
// profiles.language de quem convida, senão pt-MZ. As mensagens de erro
// devolvidas seguem a língua de quem convida.

type Msg = Localized

const ERRORS = {
  UNAUTHENTICATED: {
    'pt-MZ': 'Sessão inválida. Entre novamente no sistema.',
    'en-GB': 'Invalid session. Please sign in again.',
    'fr-FR': 'Session invalide. Veuillez vous reconnecter.',
  },
  INVALID_EMAIL: {
    'pt-MZ': 'Indique um endereço de email válido.',
    'en-GB': 'Please enter a valid e-mail address.',
    'fr-FR': 'Veuillez indiquer une adresse e-mail valide.',
  },
  FORBIDDEN_ADMIN: {
    'pt-MZ': 'Apenas administradores da plataforma podem convidar administradores.',
    'en-GB': 'Only platform administrators can invite administrators.',
    'fr-FR': 'Seuls les administrateurs de la plateforme peuvent inviter des administrateurs.',
  },
  COMPANY_REQUIRED: {
    'pt-MZ': 'Empresa não indicada.',
    'en-GB': 'No company specified.',
    'fr-FR': 'Aucune entreprise indiquée.',
  },
  COMPANY_NOT_FOUND: {
    'pt-MZ': 'Empresa não encontrada.',
    'en-GB': 'Company not found.',
    'fr-FR': 'Entreprise introuvable.',
  },
  FORBIDDEN_OWNER: {
    'pt-MZ': 'Apenas o proprietário da empresa pode adicionar utilizadores.',
    'en-GB': 'Only the company owner can add users.',
    'fr-FR': "Seul le propriétaire de l'entreprise peut ajouter des utilisateurs.",
  },
  SMTP_CONFIG_MISSING: {
    'pt-MZ': 'O serviço de e-mail da plataforma não está configurado, por isso não é possível enviar o convite. Contacte o suporte do ISPC Fácil.',
    'en-GB': "The platform's e-mail service is not configured, so the invitation cannot be sent. Please contact ISPC Fácil support.",
    'fr-FR': "Le service e-mail de la plateforme n'est pas configuré : l'invitation ne peut donc pas être envoyée. Veuillez contacter le support d'ISPC Fácil.",
  },
  LINK_FAILED: {
    'pt-MZ': 'Não foi possível gerar o link de acesso para este email.',
    'en-GB': 'Could not generate an access link for this e-mail.',
    'fr-FR': "Impossible de générer le lien d'accès pour cet e-mail.",
  },
  USER_CREATE_FAILED: {
    'pt-MZ': 'Não foi possível criar a conta do utilizador.',
    'en-GB': "Could not create the user's account.",
    'fr-FR': "Impossible de créer le compte de l'utilisateur.",
  },
  EMAIL_NOT_SENT: {
    'pt-MZ': 'O acesso foi criado, mas o email de convite não pôde ser enviado. Peça ao utilizador para usar "Esqueci a senha" no ecrã de entrada.',
    'en-GB': 'Access was created, but the invitation e-mail could not be sent. Ask the user to use "Forgot password" on the sign-in screen.',
    'fr-FR': "L'accès a été créé, mais l'e-mail d'invitation n'a pas pu être envoyé. Demandez à l'utilisateur d'utiliser « Mot de passe oublié » sur l'écran de connexion.",
  },
} satisfies Record<string, Msg>

/** Textos do e-mail de convite. Os argumentos já vêm escapados. */
const INVITE = {
  defaultRole: { 'pt-MZ': 'Membro', 'en-GB': 'Member', 'fr-FR': 'Membre' },
  /** Papéis de company_users (roleCode enviado pela app). */
  roles: {
    owner: { 'pt-MZ': 'Proprietário', 'en-GB': 'Owner', 'fr-FR': 'Propriétaire' },
    admin: { 'pt-MZ': 'Administrador', 'en-GB': 'Administrator', 'fr-FR': 'Administrateur' },
    manager: { 'pt-MZ': 'Gestor', 'en-GB': 'Manager', 'fr-FR': 'Gestionnaire' },
    user: { 'pt-MZ': 'Utilizador', 'en-GB': 'User', 'fr-FR': 'Utilisateur' },
    invited: { 'pt-MZ': 'Convidado', 'en-GB': 'Guest', 'fr-FR': 'Invité' },
  } as Record<string, Localized<string>>,
  defaultInviter: { 'pt-MZ': 'Um administrador', 'en-GB': 'An administrator', 'fr-FR': 'Un administrateur' },
  defaultCompany: { 'pt-MZ': 'uma empresa', 'en-GB': 'a company', 'fr-FR': 'une entreprise' },
  adminTitleNew: {
    'pt-MZ': 'Convite para aceder ao Back Office',
    'en-GB': 'Invitation to access the Back Office',
    'fr-FR': 'Invitation à accéder au Back Office',
  },
  adminTitleExisting: {
    'pt-MZ': 'Adicionado ao Back Office',
    'en-GB': 'Added to the Back Office',
    'fr-FR': 'Ajouté(e) au Back Office',
  },
  adminBodyNew: {
    'pt-MZ': (inviter: string, role: string) =>
      `<strong>${inviter}</strong> adicionou-o(a) como <strong>${role}</strong> no Back Office do ISPC Fácil.`,
    'en-GB': (inviter: string, role: string) =>
      `<strong>${inviter}</strong> has added you as <strong>${role}</strong> in the ISPC Fácil Back Office.`,
    'fr-FR': (inviter: string, role: string) =>
      `<strong>${inviter}</strong> vous a ajouté(e) en tant que <strong>${role}</strong> dans le Back Office d'ISPC Fácil.`,
  },
  adminBodyExisting: {
    'pt-MZ': (role: string) =>
      `A sua conta foi configurada com acesso de <strong>${role}</strong> no Back Office do ISPC Fácil.`,
    'en-GB': (role: string) =>
      `Your account has been set up with <strong>${role}</strong> access in the ISPC Fácil Back Office.`,
    'fr-FR': (role: string) =>
      `Votre compte a été configuré avec un accès <strong>${role}</strong> dans le Back Office d'ISPC Fácil.`,
  },
  companyTitleNew: {
    'pt-MZ': (company: string) => `Convite para aceder à empresa ${company}`,
    'en-GB': (company: string) => `Invitation to access the company ${company}`,
    'fr-FR': (company: string) => `Invitation à accéder à l'entreprise ${company}`,
  },
  companyTitleExisting: {
    'pt-MZ': (company: string) => `Adicionado à empresa ${company}`,
    'en-GB': (company: string) => `Added to the company ${company}`,
    'fr-FR': (company: string) => `Ajouté(e) à l'entreprise ${company}`,
  },
  companyBody: {
    'pt-MZ': (inviter: string, company: string, role: string) =>
      `<strong>${inviter}</strong> adicionou-o(a) à empresa <strong>${company}</strong> no ISPC Fácil com o papel de <strong>${role}</strong>.`,
    'en-GB': (inviter: string, company: string, role: string) =>
      `<strong>${inviter}</strong> has added you to the company <strong>${company}</strong> on ISPC Fácil with the role of <strong>${role}</strong>.`,
    'fr-FR': (inviter: string, company: string, role: string) =>
      `<strong>${inviter}</strong> vous a ajouté(e) à l'entreprise <strong>${company}</strong> sur ISPC Fácil avec le rôle <strong>${role}</strong>.`,
  },
  buttonNew: {
    'pt-MZ': 'Aceitar Convite & Criar Senha',
    'en-GB': 'Accept Invitation & Create Password',
    'fr-FR': 'Accepter l\'invitation et créer un mot de passe',
  },
  buttonExisting: {
    'pt-MZ': 'Aceder ao ISPC Fácil',
    'en-GB': 'Go to ISPC Fácil',
    'fr-FR': 'Accéder à ISPC Fácil',
  },
  hello: { 'pt-MZ': 'Olá', 'en-GB': 'Hello', 'fr-FR': 'Bonjour' },
  instructionsNew: {
    'pt-MZ': 'Para aceitar o convite e definir a sua palavra-passe de acesso, clique no botão abaixo:',
    'en-GB': 'To accept the invitation and set your password, click the button below:',
    'fr-FR': "Pour accepter l'invitation et définir votre mot de passe, cliquez sur le bouton ci-dessous :",
  },
  instructionsExisting: {
    'pt-MZ': 'A sua conta já tem acesso a esta secção. Clique no botão abaixo para iniciar sessão:',
    'en-GB': 'Your account already has access to this area. Click the button below to sign in:',
    'fr-FR': 'Votre compte a déjà accès à cette section. Cliquez sur le bouton ci-dessous pour vous connecter :',
  },
  linkFallback: {
    'pt-MZ': 'Se o botão não funcionar, copie e cole o seguinte link no seu navegador:',
    'en-GB': "If the button doesn't work, copy and paste the following link into your browser:",
    'fr-FR': 'Si le bouton ne fonctionne pas, copiez et collez le lien suivant dans votre navigateur :',
  },
  footer: {
    'pt-MZ': 'Este é um e-mail automático do sistema ISPC Fácil. Não responda a esta mensagem.',
    'en-GB': 'This is an automated e-mail from ISPC Fácil. Please do not reply to this message.',
    'fr-FR': "Ceci est un e-mail automatique d'ISPC Fácil. Merci de ne pas répondre à ce message.",
  },
}

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

  // Língua da interface de quem convida (para as mensagens de erro).
  let uiLang: EmailLanguage = 'pt-MZ'

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { email, fullName, phone, companyId, companyName, role, roleCode, inviterName, isPlatformAdmin, language } = await req.json()
    const requestedLanguage = typeof language === 'string' && language.trim() ? normalizeLanguage(language) : null
    if (requestedLanguage) uiLang = requestedLanguage

    // 0. Quem está a convidar? Só o proprietário da empresa (ou um administrador
    //    da plataforma, no Back Office) pode criar contas e enviar convites.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: callerData, error: callerError } = await supabaseClient.auth.getUser(jwt)
    const caller = callerData?.user
    if (callerError || !caller) {
      throw new HttpError(401, pick(ERRORS.UNAUTHENTICATED, uiLang), 'UNAUTHENTICATED')
    }
    if (!requestedLanguage) uiLang = await getUserLanguage(supabaseClient, caller.id)

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      throw new HttpError(400, pick(ERRORS.INVALID_EMAIL, uiLang), 'INVALID_EMAIL')
    }

    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()
    const callerIsPlatformAdmin = callerProfile?.role === 'admin'

    if (isPlatformAdmin) {
      if (!callerIsPlatformAdmin) {
        throw new HttpError(403, pick(ERRORS.FORBIDDEN_ADMIN, uiLang), 'FORBIDDEN')
      }
    } else {
      if (!companyId) {
        throw new HttpError(400, pick(ERRORS.COMPANY_REQUIRED, uiLang), 'COMPANY_REQUIRED')
      }
      const { data: company } = await supabaseClient
        .from('companies')
        .select('user_id')
        .eq('id', companyId)
        .maybeSingle()
      if (!company) {
        throw new HttpError(404, pick(ERRORS.COMPANY_NOT_FOUND, uiLang), 'COMPANY_NOT_FOUND')
      }
      if (company.user_id !== caller.id && !callerIsPlatformAdmin) {
        throw new HttpError(403, pick(ERRORS.FORBIDDEN_OWNER, uiLang), 'FORBIDDEN')
      }
    }

    // 1. Validar o SMTP ANTES de criar contas: antes, a conta era criada e o
    //    convite nunca chegava, deixando o utilizador sem forma de definir senha.
    const smtpHost = Deno.env.get("SMTP_HOST")
    const smtpUser = Deno.env.get("SMTP_USER")
    const smtpPass = Deno.env.get("SMTP_PASS")
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465")

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new HttpError(503, pick(ERRORS.SMTP_CONFIG_MISSING, uiLang), 'SMTP_CONFIG_MISSING')
    }

    const cleanEmail = email.trim().toLowerCase()
    // O convidado entra pelo subdomínio da conta a que a empresa pertence.
    const siteUrl = isPlatformAdmin ? rootSiteUrl() : await accountUrlForCompany(supabaseClient, companyId)
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
        throw new HttpError(500, pick(ERRORS.LINK_FAILED, uiLang), 'LINK_FAILED')
      }
      actionLink = recoveryData.properties.action_link
      targetUserId = targetUserId || recoveryData.user?.id || null
      isNewUser = true
    }

    if (!targetUserId) {
      throw new HttpError(500, pick(ERRORS.USER_CREATE_FAILED, uiLang), 'USER_CREATE_FAILED')
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

    // Língua do e-mail: a do convidado, se já a tiver escolhido; senão a de quem convida.
    let mailLang: EmailLanguage = uiLang
    if (existingProfile?.id) {
      const { data: invitedLang, error: invitedLangError } = await supabaseClient
        .from('profiles')
        .select('language')
        .eq('id', existingProfile.id)
        .maybeSingle()
      if (invitedLangError) console.warn('Não foi possível ler a língua do convidado:', invitedLangError.message)
      else if (invitedLang?.language) mailLang = normalizeLanguage(invitedLang.language)
    }
    const t = <T,>(texts: Localized<T>): T => pick(texts, mailLang)

    const knownRole = typeof roleCode === 'string' ? INVITE.roles[roleCode] : undefined
    const roleName = escapeHtml(knownRole ? t(knownRole) : (role || t(INVITE.defaultRole)))
    const inviter = escapeHtml(inviterName || t(INVITE.defaultInviter))
    const company = escapeHtml(companyName || t(INVITE.defaultCompany))
    const greetingName = escapeHtml(fullName || existingProfile?.full_name || cleanEmail)
    const safeLink = escapeHtml(actionLink)

    let titleText = ''
    let bodyText = ''

    if (isPlatformAdmin) {
      titleText = isNewUser ? t(INVITE.adminTitleNew) : t(INVITE.adminTitleExisting)
      bodyText = isNewUser
        ? t(INVITE.adminBodyNew)(inviter, roleName)
        : t(INVITE.adminBodyExisting)(roleName)
    } else {
      titleText = isNewUser ? t(INVITE.companyTitleNew)(company) : t(INVITE.companyTitleExisting)(company)
      bodyText = t(INVITE.companyBody)(inviter, company, roleName)
    }

    const buttonText = isNewUser ? t(INVITE.buttonNew) : t(INVITE.buttonExisting)

    const htmlContent = `
      <div lang="${htmlLang(mailLang)}" style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #f16c39; border-bottom: 2px solid #f16c39; padding-bottom: 12px; margin-top: 0;">✅ ${titleText}</h2>
        <p style="font-size: 15px; color: #333;">${t(INVITE.hello)} <strong>${greetingName}</strong>,</p>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          ${bodyText}
        </p>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          ${isNewUser ? t(INVITE.instructionsNew) : t(INVITE.instructionsExisting)}
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${safeLink}" style="background-color: #f16c39; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">${buttonText}</a>
        </div>
        <p style="font-size: 12px; color: #777;">${t(INVITE.linkFallback)}</p>
        <p style="word-break: break-all; font-size: 11px; color: #999;">${safeLink}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 32px;"/>
        <p style="font-size: 11px; color: #aaa; text-align: center;">${t(INVITE.footer)}</p>
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
        warning: pick(ERRORS.EMAIL_NOT_SENT, uiLang),
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
