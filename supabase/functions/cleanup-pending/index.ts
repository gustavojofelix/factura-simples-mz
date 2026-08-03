import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

// Endpoint to clean up pending payments and all subscriptions.
// WARNING: This permanently removes data. Use only in dev or with explicit consent.

serve(async (req) => {
  // Simple auth – require a secret query param to avoid accidental calls.
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (secret !== Deno.env.get('CLEANUP_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1️⃣ Delete pending payments
    const { error: delPaymentsError, count: delPaymentsCount } = await supabase
      .from('subscription_payments')
      .delete()
      .eq('status', 'pending')
      .select('id', { count: 'exact' });

    if (delPaymentsError) throw delPaymentsError;

    // 2️⃣ Delete all subscriptions (any status)
    const { error: delSubsError, count: delSubsCount } = await supabase
      .from('subscriptions')
      .delete()
      .neq('id', '') // matches any non‑empty id → deletes all rows
      .select('id', { count: 'exact' });

    if (delSubsError) throw delSubsError;

    return new Response(
      JSON.stringify({
        success: true,
        deletedPendingPayments: delPaymentsCount ?? 0,
        deletedSubscriptions: delSubsCount ?? 0,
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error('Cleanup error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Unknown error' }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
