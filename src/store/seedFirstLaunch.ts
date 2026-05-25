import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { STORAGE_KEYS } from './storage';
import { useRecipeStore } from './useRecipeStore';
import { usePantryStore } from './usePantryStore';
import { useAuthStore } from './useAuthStore';
import { SEED_RECIPES, SEED_PANTRY } from '../data/seedRecipes';

export async function seedIfFirstLaunch(): Promise<void> {
  try {
    const flag = await AsyncStorage.getItem(STORAGE_KEYS.seeded);
    if (flag) return;
    // Skip seeding when a user is signed in — their account state arrives via pullAll.
    if (useAuthStore.getState().session) {
      await AsyncStorage.setItem(STORAGE_KEYS.seeded, '1');
      return;
    }

    const recipes = useRecipeStore.getState().recipes;
    if (recipes.length === 0) {
      const now = Date.now();
      useRecipeStore.getState().replaceAll(
        SEED_RECIPES.map((r) => ({ ...r, id: r.id, createdAt: now, updatedAt: now }))
      );
    }

    const pantry = usePantryStore.getState().items;
    if (pantry.length === 0) {
      usePantryStore.getState().replaceAll(
        SEED_PANTRY.map((p) => ({ ...p, id: uuid() }))
      );
    }

    await AsyncStorage.setItem(STORAGE_KEYS.seeded, '1');
  } catch {
    // best-effort; skip on failure
  }
}
