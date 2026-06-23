import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { MealSlot, ScheduleCell } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';
import { useMealPlanStore } from './useMealPlanStore';
import { sumServingsByRecipe } from '../utils/scheduleToPlan';

// Placement of a recipe into the week calendar, used to commit several cells at
// once from the auto-planner (which already knows day + slot per meal).
export interface PlannedCell {
  day: number;
  slot: MealSlot;
  recipeId: string;
  desiredServings: number;
}

interface MealScheduleState {
  cells: ScheduleCell[];
  assign: (day: number, slot: MealSlot, recipeId: string, desiredServings: number) => void;
  removeCell: (id: string) => void;
  updateCellServings: (id: string, desiredServings: number) => void;
  moveCell: (id: string, day: number, slot: MealSlot) => void;
  setFromPlanned: (placed: PlannedCell[]) => void;
  clearSchedule: () => void;
}

// Project the affected recipes' total servings (summed across all their cells)
// back into the synced meal plan. This is the ONLY way the calendar touches
// `entries` — placement is device-local, but membership + totals stay synced so
// the grocery pipeline and nutrition keep working unchanged. Reconciling per
// recipe (rather than rebuilding the whole list) deliberately leaves untouched
// any entry that has no cell yet — the "unscheduled" recipes shown on the
// Weekly Plan screen (e.g. a plan synced from another device).
function reconcileRecipes(cells: ScheduleCell[], recipeIds: Iterable<string>): void {
  const totals = sumServingsByRecipe(cells);
  const plan = useMealPlanStore.getState();
  for (const recipeId of new Set(recipeIds)) {
    const total = totals.get(recipeId) ?? 0;
    if (total > 0) plan.addEntry(recipeId, total);
    else plan.removeEntry(recipeId);
  }
}

export const useMealScheduleStore = create<MealScheduleState>()(
  persist(
    (set, get) => ({
      cells: [],
      assign: (day, slot, recipeId, desiredServings) => {
        const servings = Math.max(1, Math.round(desiredServings));
        const next = [...get().cells, { id: uuid(), day, slot, recipeId, desiredServings: servings }];
        set({ cells: next });
        reconcileRecipes(next, [recipeId]);
      },
      removeCell: (id) => {
        const removed = get().cells.find((c) => c.id === id);
        if (!removed) return;
        const next = get().cells.filter((c) => c.id !== id);
        set({ cells: next });
        reconcileRecipes(next, [removed.recipeId]);
      },
      updateCellServings: (id, desiredServings) => {
        const servings = Math.max(1, Math.round(desiredServings));
        const target = get().cells.find((c) => c.id === id);
        if (!target) return;
        const next = get().cells.map((c) => (c.id === id ? { ...c, desiredServings: servings } : c));
        set({ cells: next });
        reconcileRecipes(next, [target.recipeId]);
      },
      moveCell: (id, day, slot) => {
        // Moving keeps the recipe's total servings unchanged, so no reconcile.
        set((s) => ({ cells: s.cells.map((c) => (c.id === id ? { ...c, day, slot } : c)) }));
      },
      setFromPlanned: (placed) => {
        const prev = get().cells;
        const next = placed.map((p) => ({
          id: uuid(),
          day: p.day,
          slot: p.slot,
          recipeId: p.recipeId,
          desiredServings: Math.max(1, Math.round(p.desiredServings)),
        }));
        set({ cells: next });
        // Reconcile every recipe that appeared in the old OR new placement so
        // dropped recipes get their entry removed and new ones get added.
        const affected = [...prev.map((c) => c.recipeId), ...next.map((c) => c.recipeId)];
        reconcileRecipes(next, affected);
      },
      clearSchedule: () => set({ cells: [] }),
    }),
    {
      name: STORAGE_KEYS.mealSchedule,
      storage: zustandStorage,
    }
  )
);
