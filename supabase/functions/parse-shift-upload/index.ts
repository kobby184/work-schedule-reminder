import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { demoParse, parseScheduleText } from '../_shared/parser.ts';

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
    const aliases = Array.isArray(body.aliases) ? body.aliases : [];
    const timezone = typeof body.timezone === 'string' ? body.timezone : 'America/New_York';

    let result;
    if (typeof body.rawText === 'string' && body.rawText.trim()) {
      result = parseScheduleText(body.rawText, { aliases, timezone });
    } else if (!Deno.env.get('GOOGLE_DOCUMENT_AI_PROCESS_URL')) {
      result = demoParse({ aliases, timezone });
    } else {
      return jsonResponse(
        {
          error: 'Document AI OCR endpoint is configured, but file-to-OCR exchange must be enabled with a Google service account before production use.',
        },
        501,
      );
    }

    if (body.uploadId) {
      await supabase
        .from('shift_uploads')
        .update({
          status: result.blocked ? 'blocked' : 'parsed',
          parser_message: result.message,
        })
        .eq('id', body.uploadId)
        .eq('user_id', userData.user.id);
    }

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown parse error' }, 500);
  }
});
