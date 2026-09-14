import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MealPlanEntry } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';

interface MealPlanState {
  entries: MealPlanEntry[];
  // How many days the current plan covers. Drives the "daily" nutrition math
  // (weekly totals / planDays). Device-local by design: the sync subscriber
  // diffs `entries` only, so this field is never pushed to the server.
  planDays: number;
  addEntry: (recipeId: string, desiredServings: number) => void;
  updateServings: (recipeId: string, desiredServings: number) => void;
  removeEntry: (recipeId: string) => void;
  setPlanDays: (days: number) => void;
  clearPlan: () => void;
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set) => ({
      entries: [],
      planDays: 7,
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
      setPlanDays: (days) => {
        set({ planDays: Math.max(1, Math.round(days)) });
      },
      clearPlan: () => set({ entries: [], planDays: 7 }),
    }),
    {
      name: STORAGE_KEYS.mealPlan,
      storage: zustandStorage,
    }
  )
);
