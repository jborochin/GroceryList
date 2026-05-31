import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider, ActivityIndicator } from 'react-native-paper';
import { NavigationContainer } from '@react-navigation/native';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import { RootNavigator } from './src/navigation/RootNavigator';
import { darkTheme } from './src/theme/theme';
import { AmbientBackground } from './src/components/ui/AmbientBackground';
import { ParallaxProvider } from './src/components/ui/ParallaxContext';
import { useHydration } from './src/store/hydration';
import { seedIfFirstLaunch } from './src/store/seedFirstLaunch';
import { useAuthStore } from './src/store/useAuthStore';
import { ToastHost } from './src/components/ui/ToastHost';
import { drainOutbox, migrateLocalToAccount, pullAll, subscribeStores, unsubscribeStores } from './src/lib/sync';
import { supabaseConfigured } from './src/lib/supabase';

export default function App() {
  // Single Liquid Glass aesthetic: always the dark theme + light status bar.
  const theme = darkTheme;
  const hydrated = useHydration();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [seeded, setSeeded] = useState(false);
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  useEffect(() => {
    if (hydrated && !seeded) {
      seedIfFirstLaunch().finally(() => setSeeded(true));
    }
  }, [hydrated, seeded]);

  // Drive sync lifecycle from auth state.
  useEffect(() => {
    if (!hydrated || !seeded || !supabaseConfigured) return;
    if (!userId) {
      unsubscribeStores();
      return;
    }
    let cancelled = false;
    (async () => {
      await migrateLocalToAccount(userId);
      if (cancelled) return;
      await pullAll(userId);
      if (cancelled) return;
      subscribeStores(userId);
      void drainOutbox();
    })();
    return () => {
      cancelled = true;
      unsubscribeStores();
    };
  }, [hydrated, seeded, userId]);

  // Pull + drain on app foreground.
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainOutbox();
        void pullAll(userId);
      }
    });
    return () => sub.remove();
  }, [userId]);

  if (!hydrated || !seeded || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <ParallaxProvider>
            <View style={{ flex: 1, backgroundColor: '#000000' }}>
              {/* Radial backdrop rendered once, behind the whole navigator. */}
              <AmbientBackground />
              <NavigationContainer theme={{
                dark: true,
                colors: {
                  primary: theme.colors.primary,
                  background: 'transparent',
                  card: theme.colors.surface,
                  text: theme.colors.onSurface,
                  border: theme.colors.outline,
                  notification: theme.colors.secondary,
                },
              }}>
                <ToastHost>
                  <RootNavigator />
                </ToastHost>
                <StatusBar style="light" translucent />
              </NavigationContainer>
            </View>
          </ParallaxProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
