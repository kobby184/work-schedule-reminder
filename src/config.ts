import Constants from 'expo-constants';

const env = ((globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env ?? {}) as Record<string, string | undefined>;

export const appConfig = {
  supabaseUrl:
    env.EXPO_PUBLIC_SUPABASE_URL ??
    (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ??
    '',
  supabaseAnonKey:
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined) ??
    '',
};

export const isSupabaseConfigured = Boolean(appConfig.supabaseUrl && appConfig.supabaseAnonKey);
