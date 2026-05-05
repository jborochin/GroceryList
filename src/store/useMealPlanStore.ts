import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MealPlanEntry } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface MealPlanState {
  entries: MealPlanEntry[];
  addEntry: (recipeId: string, desiredServings: number) => void;
  updateServings: (recipeId: string, desiredServings: number) => void;
  removeEntry: (recipeId: string) => void;
  clearPlan: () => void;
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (recipeId, desiredServings) => {
        set((s) => {
          if (s.entries.some((e) => e.recipeId === recipeId)) {
            return {
              entries: s.entries.map((e) =>
                e.recipeId === recipeId ? { ...e, desiredServings } : e
              ),
            };
          }
          return { entries: [...s.entries, { recipeId, desiredServings }] };
        });
      },
      updateServings: (recipeId, desiredServings) => {
        const safe = Math.max(1, Math.round(desiredServings));
        set((s) => ({
          entries: s.entries.map((e) =>
            e.recipeId === recipeId ? { ...e, desiredServings: safe } : e
          ),
        }));
      },
      removeEntry: (recipeId) => {
        set((s) => ({ entries: s.entries.filter((e) => e.recipeId !== recipeId) }));
      },
      clearPlan: () => set({ entries: [] }),
    }),
    {
      name: STORAGE_KEYS.mealPlan,
      storage: zustandStorage,
    }
  )
);
