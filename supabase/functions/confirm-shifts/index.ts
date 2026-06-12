import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    if (!Array.isArray(body.shifts)) {
      return jsonResponse({ error: 'Expected shifts array' }, 400);
    }

    const rows = body.shifts.map((shift) => ({
      user_id: userData.user.id,
      workplace_id: body.workplaceId ?? null,
      upload_id: body.uploadId ?? null,
      title: shift.title ?? 'Work shift',
      unit: shift.unit ?? '',
      role: shift.role ?? '',
      start_at: shift.startAt,
      end_at: shift.endAt,
      timezone: shift.timezone ?? 'America/New_York',
      status: 'scheduled',
      source: 'upload',
      confidence: shift.confidence ?? null,
      notes: shift.notes ?? null,
    }));

    const { data, error } = await supabase.from('shifts').insert(rows).select('*');
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    if (body.uploadId) {
      await supabase
        .from('shift_uploads')
        .update({ status: 'confirmed' })
        .eq('id', body.uploadId)
        .eq('user_id', userData.user.id);
    }

    return jsonResponse({ shifts: data });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown confirmation error' }, 500);
  }
});
