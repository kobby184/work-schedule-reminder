import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

type CallRequest = {
  phoneNumber?: string;
  displayName?: string;
  mobilePhone?: string;
  shiftTitle?: string;
  unit?: string;
  role?: string;
  startAt?: string;
  timezone?: string;
};

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

    const body = (await req.json()) as CallRequest;
    const to = normalizePhoneNumber(body.phoneNumber ?? '');
    if (!to) {
      return jsonResponse({ error: 'Call-off phone number must be a valid US or E.164 number.' }, 400);
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const from = normalizePhoneNumber(Deno.env.get('TWILIO_FROM_NUMBER') ?? '');
    if (!accountSid || !authToken || !from) {
      return jsonResponse({ error: 'Twilio is not configured for automatic office calls.' }, 503);
    }

    const twiml = buildCalloffTwiml(body);
    const params = new URLSearchParams({
      To: to,
      From: from,
      Twiml: twiml,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { message: text };
    }

    if (!response.ok) {
      const message = typeof payload.message === 'string' ? payload.message : 'Twilio call request failed.';
      return jsonResponse({ error: message }, response.status >= 400 && response.status < 500 ? 400 : 502);
    }

    return jsonResponse({
      callSid: typeof payload.sid === 'string' ? payload.sid : undefined,
      status: typeof payload.status === 'string' ? payload.status : undefined,
      message: 'Automatic office call started.',
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Automatic office call failed.' }, 500);
  }
});

function buildCalloffTwiml(body: CallRequest) {
  const name = cleanForSpeech(body.displayName) || 'this employee';
  const role = cleanForSpeech(body.role) || 'staff';
  const title = cleanForSpeech(body.shiftTitle) || 'work';
  const unit = cleanForSpeech(body.unit);
  const contact = cleanForSpeech(body.mobilePhone);
  const start = formatShiftStart(body.startAt, body.timezone);
  const shiftDescription = [role, title, unit ? `on ${unit}` : '', start ? `scheduled for ${start}` : '']
    .filter(Boolean)
    .join(' ');
  const contactSentence = contact ? ` Please contact them at ${spokenPhone(contact)} if more information is needed.` : '';
  const message = `This is an automated call from ShiftReady for ${name}. They are calling off their ${shiftDescription}.${contactSentence}`;
  const escaped = escapeXml(message);

  return `<Response><Say voice="alice">${escaped}</Say><Pause length="1"/><Say voice="alice">${escaped}</Say></Response>`;
}

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (/^\+\d{10,15}$/.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return '';
}

function cleanForSpeech(value?: string) {
  return (value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function spokenPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? digits.split('').join(' ') : value;
}

function formatShiftStart(value?: string, timezone?: string) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || 'America/New_York',
    }).format(date);
  } catch {
    return date.toLocaleString('en-US');
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
