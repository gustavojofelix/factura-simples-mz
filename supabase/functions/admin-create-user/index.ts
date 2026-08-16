import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only callable by authenticated admins (verified by caller's JWT in RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { email, password, full_name, phone, status } = await req.json()

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ success: false, error: 'email, password e full_name são obrigatórios.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()

    // Validate password strength server-side
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ success: false, error: 'A palavra-passe deve ter pelo menos 6 caracteres.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Check if user already exists
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', cleanEmail)
      .maybeSingle()

    if (existing?.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Já existe um utilizador com este e-mail.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      )
    }

    // Create user via Auth Admin API (server-side only, never exposed to client)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name.trim(),
        phone: phone || null
      }
    })

    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ success: false, error: authError?.message || 'Erro ao criar utilizador.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const userId = authData.user.id

    // Upsert profile record with provided status
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: full_name.trim(),
        email: cleanEmail,
        phone: phone || null,
        status: status || 'active',
        role: 'user'
      }, { onConflict: 'id' })

    return new Response(
      JSON.stringify({ success: true, userId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro interno do servidor.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
