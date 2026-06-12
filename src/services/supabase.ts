import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { appConfig, isSupabaseConfigured } from '../config';

export const supabase = isSupabaseConfigured
  ? createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export async function signInOrCreateAccount(email: string, password: string) {
  if (!supabase) {
    return { userId: 'local-demo-user', mode: 'local' as const };
  }

  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.data.user) {
    return { userId: signIn.data.user.id, mode: 'remote' as const };
  }

  const signUp = await supabase.auth.signUp({ email, password });
  if (signUp.error) {
    throw signUp.error;
  }
  return { userId: signUp.data.user?.id ?? 'pending-email-confirmation', mode: 'remote' as const };
}
