import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider, ActivityIndicator } from 'react-native-paper';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { AppState, Platform, View } from 'react-native';
import { ShareIntentProvider } from 'expo-share-intent';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import { RootNavigator } from './src/navigation/RootNavigator';
import { darkTheme } from './src/theme/theme';
import { AmbientBackground } from './src/components/ui/AmbientBackground';
import { ParallaxProvider } from './src/components/ui/ParallaxContext';
import { useHydration } from './src/store/hydration';
import { seedIfFirstLaunch } from './src/store/seedFirstLaunch';
import { useAuthStore } from './src/store/useAuthStore';
import { ToastHost } from './src/components/ui/ToastHost';
import { ShareIntentRouter } from './src/components/ShareIntentRouter';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { RootStackParamList } from './src/navigation/types';
import { drainOutbox, migrateLocalToAccount, pullAll, subscribeStores, unsubscribeStores } from './src/lib/sync';
import { loadPriceCache, refreshPriceCache } from './src/lib/priceCatalogSync';
import { configureCookNotifications } from './src/lib/cookNotifications';
import { supabaseConfigured } from './src/lib/supabase';

// Cook-mode timer alerts should surface even with the app foregrounded — during
// a cook the phone is often face-down or across the kitchen. Set once at module
// scope; permission itself is requested lazily on the first timer.
configureCookNotifications();

export default function App() {
  // Single Liquid Glass aesthetic: near-white MealFlow field + dark status bar.
  const theme = darkTheme;
  const hydrated = useHydration();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [seeded, setSeeded] = useState(false);
  // Shares are routed imperatively (see useShareIntentRouter), and one can arrive
  // before the navigator mounts on a cold start, so readiness is tracked.
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  useEffect(() => {
    if (hydrated && !seeded) {
      // Legacy recipe ids are remapped inside useHydration, before the week reconcile.
      seedIfFirstLaunch().finally(() => setSeeded(true));
    }
  }, [hydrated, seeded]);

  // Live price overlay: read the last-known prices, then refresh from the server
  // mirror. Once per app start rather than per screen mount — the overlay is
  // global and screens recompute off usePriceCatalogStore's version counter.
  // Fire-and-forget by design: both calls swallow their own errors and the
  // bundled priceDatabase.json is always the floor.
  useEffect(() => {
    loadPriceCache().then(refreshPriceCache);
  }, []);

  // Drive sync lifecycle from auth state. Subscribe BEFORE the first pull so
  // any edit made while the pull is in flight is pushed (or outboxed) — the
  // merge in pullAll then knows not to clobber it. Drain before pull so queued
  // offline deletes reach the server before we fetch.
  useEffect(() => {
    if (!hydrated || !seeded || !supabaseConfigured) return;
    if (!userId) {
      unsubscribeStores();
      return;
    }
    let cancelled = false;
    subscribeStores(userId);
    (async () => {
      await migrateLocalToAccount(userId);
      if (cancelled) return;
      await drainOutbox(userId);
      if (cancelled) return;
      await pullAll(userId);
    })();
    return () => {
      cancelled = true;
      unsubscribeStores();
    };
  }, [hydrated, seeded, userId]);

  // Drain then pull on app foreground (sequential: deletes must land first).
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void (async () => {
          await drainOutbox(userId);
          await pullAll(userId);
        })();
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
    // Share intents are native-only; the module is absent in Expo Go and on web,
    // where the hook disables itself rather than failing.
    <ShareIntentProvider options={{ disabled: Platform.OS === 'web', resetOnBackground: true }}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <ParallaxProvider>
            <View style={{ flex: 1, backgroundColor: '#F5F8F6' }}>
              {/* Radial backdrop rendered once, behind the whole navigator. */}
              <AmbientBackground />
              <NavigationContainer
                ref={navigationRef}
                onReady={() => setNavReady(true)}
                theme={{
                dark: false,
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
                  <AppErrorBoundary>
                    <RootNavigator />
                  </AppErrorBoundary>
                </ToastHost>
                <ShareIntentRouter navigationRef={navigationRef} ready={navReady} />
                <StatusBar style="dark" translucent />
              </NavigationContainer>
            </View>
          </ParallaxProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
