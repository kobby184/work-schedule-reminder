import type { Profile, Shift } from '../types';
import { supabase } from './supabase';

type AutomatedCallResult = {
  callSid?: string;
  status?: string;
  message: string;
};

export async function placeAutomatedCalloffCall(shift: Shift, profile: Profile): Promise<AutomatedCallResult> {
  if (!supabase) {
    throw new Error('Automatic calls require Supabase and Twilio configuration.');
  }

  const invoked = await supabase.functions.invoke('place-calloff-call', {
    body: {
      phoneNumber: profile.calloffPhone,
      displayName: profile.displayName,
      mobilePhone: profile.mobilePhone,
      shiftTitle: shift.title,
      unit: shift.unit,
      role: shift.role,
      startAt: shift.startAt,
      timezone: shift.timezone,
    },
  });

  if (invoked.error) {
    throw invoked.error;
  }

  return invoked.data as AutomatedCallResult;
}
