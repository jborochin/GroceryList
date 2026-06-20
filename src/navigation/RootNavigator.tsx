import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen';
import { MealCatalogDetailScreen } from '../screens/MealCatalogDetailScreen';
import { AddRecipeScreen } from '../screens/AddRecipeScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { AutoMealPrepScreen } from '../screens/AutoMealPrepScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { RootStackParamList } from './types';
import { useAuthStore } from '../store/useAuthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFirstPullDone } from '../store/useSyncStateStore';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  // Onboarding gate.
  // - Local-only users: show as soon as auth init finishes.
  // - Signed-in users: wait until the first server pull completes so we don't
  //   flash Onboarding while the (already-onboarded) server settings are still
  //   in flight. pullAll() flips firstPullCompleted in its finally block, so
  //   network failure won't hang the gate.
  const authInitialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);
  const onboardingDone = useSettingsStore((s) => s.settings.onboardingCompleted);
  const firstPullDone = useFirstPullDone();
  const gateReady = authInitialized && (!user || firstPullDone);
  const showOnboarding = gateReady && !onboardingDone;

  // Mutually exclusive screen groups. When showOnboarding flips, the screens
  // backing the current route are removed from the navigator, which forces
  // React Navigation to reset to the first available screen — the right one.
  // Auth stays registered in both modes so Onboarding's "sign in" link works.
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
        animation: 'slide_from_right',
      }}
    >
      {showOnboarding ? (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ gestureEnabled: false, animation: 'fade' }}
        />
      ) : (
        <Stack.Group>
          <Stack.Screen name="Tabs" component={TabNavigator} />
          <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
          <Stack.Screen
            name="MealCatalogDetail"
            component={MealCatalogDetailScreen}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="AddRecipe"
            component={AddRecipeScreen}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen name="Pantry" component={PantryScreen} />
          <Stack.Screen
            name="AutoMealPrep"
            component={AutoMealPrepScreen}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
        </Stack.Group>
      )}
      <Stack.Screen
        name="Auth"
        component={AuthScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
