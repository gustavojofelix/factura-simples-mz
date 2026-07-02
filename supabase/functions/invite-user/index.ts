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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { email, fullName, phone } = await req.json()

    if (!email) {
      throw new Error('Email is required')
    }

    // Invite the user
    const { data, error } = await supabaseClient.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        phone: phone,
      },
    })

    if (error) throw error

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
      JSON.stringify({ user: data.user }),
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
