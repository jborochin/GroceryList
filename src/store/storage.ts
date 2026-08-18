import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

export const zustandStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  recipes: 'mealprep/recipes/v1',
  mealPlan: 'mealprep/mealPlan/v1',
  mealSchedule: 'mealprep/mealSchedule/v1',
  mealDisposition: 'mealprep/mealDisposition/v1',
  pantry: 'mealprep/pantry/v1',
  manualItems: 'mealprep/manualItems/v1',
  groceryRecipes: 'mealprep/groceryRecipes/v1',
  dismissedItems: 'mealprep/dismissedItems/v1',
  settings: 'mealprep/settings/v1',
  priceOverrides: 'mealprep/priceOverrides/v1',
  itemOverrides: 'mealprep/itemOverrides/v1',
  foodLog: 'mealprep/foodLog/v1',
  customFoods: 'mealprep/customFoods/v1',
  cookSessions: 'mealprep/cookSessions/v1',
  seeded: 'mealprep/seeded/v1',
  lastSyncedAt: 'mealprep/sync/lastSyncedAt/v1',
  outbox: 'mealprep/sync/outbox/v1',
  migratedAccountId: 'mealprep/sync/migratedAccountId/v1',
  mealCatalogCache: 'mealprep/mealCatalog/v1',
  priceCache: 'mealprep/priceCache/v1',
  favorites: 'mealprep/favorites/v1',
} as const;
