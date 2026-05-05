import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

export const zustandStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  recipes: 'mealprep/recipes/v1',
  mealPlan: 'mealprep/mealPlan/v1',
  pantry: 'mealprep/pantry/v1',
  settings: 'mealprep/settings/v1',
  priceOverrides: 'mealprep/priceOverrides/v1',
  seeded: 'mealprep/seeded/v1',
} as const;
