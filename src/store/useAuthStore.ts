import { create } from 'zustand';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, supabaseConfigured } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  initialized: boolean;
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

let authSubscription: { unsubscribe: () => void } | null = null;

export const useAuthStore = create<AuthState>()((set, get) => ({
  initialized: false,
  session: null,
  user: null,
  loading: false,
  error: null,

  initialize: async () => {
    if (get().initialized) return;
    if (!supabaseConfigured) {
      set({ initialized: true });
      return;
    }
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    set({ session: data.session ?? null, user: data.session?.user ?? null, initialized: true });

    authSubscription?.unsubscribe();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session: session ?? null, user: session?.user ?? null });
    });
    authSubscription = sub.subscription;
  },

  signInWithEmail: async (email, password) => {
    if (!supabaseConfigured) {
      set({ error: 'Supabase is not configured. See supabase/README.md.' });
      return;
    }
    set({ loading: true, error: null });
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    set({ loading: false, error: error?.message ?? null });
  },

  signUpWithEmail: async (email, password) => {
    if (!supabaseConfigured) {
      set({ error: 'Supabase is not configured. See supabase/README.md.' });
      return;
    }
    set({ loading: true, error: null });
    const { error } = await getSupabase().auth.signUp({ email, password });
    set({ loading: false, error: error?.message ?? null });
  },

  signInWithGoogle: async () => {
    if (!supabaseConfigured) {
      set({ error: 'Supabase is not configured. See supabase/README.md.' });
      return;
    }
    set({ loading: true, error: null });
    try {
      const supabase = getSupabase();
      const redirectTo = AuthSession.makeRedirectUri({ scheme: 'mealprepgrocery' });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) {
        set({ loading: false, error: error?.message ?? 'Failed to start Google sign-in.' });
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) {
        set({ loading: false, error: result.type === 'cancel' ? null : 'Google sign-in was cancelled.' });
        return;
      }

      const url = new URL(result.url);
      const params = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.search);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) {
        set({ loading: false, error: 'Missing tokens in Google redirect.' });
        return;
      }

      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
      set({ loading: false, error: setErr?.message ?? null });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Unknown error.' });
    }
  },

  signOut: async () => {
    if (!supabaseConfigured) return;
    set({ loading: true });
    await getSupabase().auth.signOut();
    set({ loading: false, session: null, user: null });
  },

  clearError: () => set({ error: null }),
}));
