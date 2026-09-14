import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GroceryRecipeEntry } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';

// Recipes queued straight onto the grocery list from a detail screen, without
// being planned. This is the second source feeding aggregate() — see the
// grocery-list pipeline in CLAUDE.md. Deliberately NOT the meal plan: entries
// here never reach the Week tab or the nutrition summary.
//
// Device-local by design (like useMealScheduleStore) — no sync wiring.
interface GroceryRecipeState {
  entries: GroceryRecipeEntry[];
  addEntry: (recipeId: string, desiredServings: number) => void;
  removeEntry: (recipeId: string) => void;
  clearAll: () => void;
}

export const useGroceryRecipeStore = create<GroceryRecipeState>()(
  persist(
    (set) => ({
      entries: [],
      // Upsert, mirroring useMealPlanStore.addEntry: re-adding a recipe retargets
      // its serving count rather than stacking a second entry for it.
      addEntry: (recipeId, desiredServings) => {
        const safe = Math.max(1, Math.round(desiredServings));
        set((s) => {
          if (s.entries.some((e) => e.recipeId === recipeId)) {
            return {
              entries: s.entries.map((e) =>
                e.recipeId === recipeId ? { ...e, desiredServings: safe } : e
              ),
            };
          }
          return { entries: [...s.entries, { recipeId, desiredServings: safe }] };
        });
      },
      removeEntry: (recipeId) => {
        set((s) => ({ entries: s.entries.filter((e) => e.recipeId !== recipeId) }));
      },
      clearAll: () => set({ entries: [] }),
    }),
    {
      name: STORAGE_KEYS.groceryRecipes,
      storage: zustandStorage,
    }
  )
);
