import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const expectedSecret = Deno.env.get('CLEANUP_JOB_SECRET');
  if (expectedSecret && req.headers.get('x-cleanup-secret') !== expectedSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: uploads, error } = await supabase
    .from('shift_uploads')
    .select('id, original_file_path')
    .neq('status', 'confirmed')
    .lt('expires_at', new Date().toISOString());

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const paths = (uploads ?? []).map((upload) => upload.original_file_path).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from('schedule-uploads').remove(paths);
  }

  const ids = (uploads ?? []).map((upload) => upload.id);
  if (ids.length) {
    await supabase.from('shift_uploads').update({ status: 'expired' }).in('id', ids);
  }

  return jsonResponse({ expired: ids.length });
});
