import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Ficheiro único (sem ../_shared), para se poder publicar também colando-o no
// editor de Edge Functions do painel do Supabase.
type Language = 'pt-MZ' | 'en-GB' | 'fr-FR'
type Localized = Record<Language, string>

function normalizeLanguage(value: unknown): Language {
  if (typeof value !== 'string') return 'pt-MZ'
  const prefix = value.trim().toLowerCase().slice(0, 2)
  return prefix === 'en' ? 'en-GB' : prefix === 'fr' ? 'fr-FR' : 'pt-MZ'
}

function pick(texts: Localized, language: Language): string {
  return texts[language] ?? texts['pt-MZ']
}

// Emparelha um dispositivo com um terminal POS.
//
// O gerente gera um código de 8 caracteres na aplicação (pos_create_pairing_code,
// válido 15 minutos). O dispositivo envia o código para aqui, sem sessão. Se o
// código for válido, cria-se um utilizador técnico só para este terminal
// (app_metadata.kind = 'pos_terminal'), sem perfil nem conta, e devolve-se a
// sessão. Esse utilizador não é membro da empresa: só chega aos dados através
// das funções pos_*.
//
// Voltar a emparelhar o mesmo terminal apaga o utilizador anterior, o que
// termina a sessão do dispositivo antigo.

const ERRORS = {
  INVALID_CODE: {
    'pt-MZ': 'Código inválido ou expirado. Gere um novo código em Ponto de Venda → Terminais.',
    'en-GB': 'Invalid or expired code. Generate a new code under Point of Sale → Terminals.',
    'fr-FR': 'Code invalide ou expiré. Générez un nouveau code dans Point de vente → Terminaux.',
  },
  PAIRING_FAILED: {
    'pt-MZ': 'Não foi possível emparelhar este dispositivo. Tente novamente.',
    'en-GB': 'Could not pair this device. Please try again.',
    'fr-FR': "Impossible d'associer cet appareil. Veuillez réessayer.",
  },
} satisfies Record<string, Localized>

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: { code?: string; language?: string; device?: string } = {}
  try {
    body = await req.json()
  } catch {
    // corpo vazio ou inválido: tratado como código inválido
  }
  const language = normalizeLanguage(body.language)
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 8) {
    return json({ error: pick(ERRORS.INVALID_CODE, language) }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: terminal, error: findError } = await admin
    .from('pos_terminals')
    .select('id, company_id, name, auth_user_id, pairing_expires_at, revoked_at')
    .eq('pairing_code_hash', await sha256Hex(code))
    .is('revoked_at', null)
    .gt('pairing_expires_at', new Date().toISOString())
    .maybeSingle()

  if (findError || !terminal) {
    return json({ error: pick(ERRORS.INVALID_CODE, language) }, 400)
  }

  try {
    // O código é de uso único: invalida-se antes de tudo o resto.
    await admin
      .from('pos_terminals')
      .update({ pairing_code_hash: null, pairing_expires_at: null })
      .eq('id', terminal.id)

    if (terminal.auth_user_id) {
      await admin.auth.admin.deleteUser(terminal.auth_user_id)
    }

    const email = `pos-${terminal.id}-${Date.now()}@terminais.ispcfacil.com`
    const password = randomPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { kind: 'pos_terminal', pos_terminal_id: terminal.id, company_id: terminal.company_id },
      user_metadata: { full_name: `Terminal POS: ${terminal.name}` },
    })
    if (createError || !created?.user) throw createError || new Error('createUser')

    const { error: updateError } = await admin
      .from('pos_terminals')
      .update({
        auth_user_id: created.user.id,
        paired_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        user_agent: (body.device || req.headers.get('user-agent') || '').slice(0, 300),
      })
      .eq('id', terminal.id)
    if (updateError) throw updateError

    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.session) throw signInError || new Error('signIn')

    const { data: company } = await admin.from('companies').select('name').eq('id', terminal.company_id).single()

    return json({
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
      terminal: { id: terminal.id, name: terminal.name },
      company: { name: company?.name ?? '' },
    })
  } catch (error) {
    console.error('pos-pair-terminal', error)
    return json({ error: pick(ERRORS.PAIRING_FAILED, language) }, 500)
  }
})
