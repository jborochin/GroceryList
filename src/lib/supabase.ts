import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function readEnv(key: string): string | undefined {
  const fromProcess = (process.env as Record<string, string | undefined>)[key];
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
  return extra[key];
}

const SUPABASE_URL = readEnv('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!supabaseConfigured) {
      throw new Error(
        'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
          'as environment variables or in app.json -> expo.extra.'
      );
    }
    _client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}
