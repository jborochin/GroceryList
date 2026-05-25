import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen';
import { AddRecipeScreen } from '../screens/AddRecipeScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { RootStackParamList } from './types';
import { useAppTheme } from '../theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const t = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.palette.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
      <Stack.Screen
        name="AddRecipe"
        component={AddRecipeScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="Pantry" component={PantryScreen} />
      <Stack.Screen
        name="Auth"
        component={AuthScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
