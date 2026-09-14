import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { MealSlot, ScheduleCell } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';
import { useMealPlanStore } from './useMealPlanStore';
import { sumServingsByRecipe } from '../utils/scheduleToPlan';
import { getWeekStart } from '../utils/planningWeek';

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
  // The week the user is looking at / planning. Every mutation below scopes to
  // it, and the synced plan entries are projected from ITS cells only — so the
  // grocery list and nutrition always describe the selected week.
  selectedWeekStart: string;
  setSelectedWeek: (weekStart: string) => void;
  assign: (day: number, slot: MealSlot, recipeId: string, desiredServings: number) => void;
  removeCell: (id: string) => void;
  updateCellServings: (id: string, desiredServings: number) => void;
  moveCell: (id: string, day: number, slot: MealSlot) => void;
  setFromPlanned: (placed: PlannedCell[]) => void;
  clearSchedule: () => void;
  /** Drop every cell of a recipe in every week and its synced plan entry — for recipe deletion. */
  removeRecipe: (recipeId: string) => void;
}

// Project the affected recipes' total servings (summed across their cells in
// `weekStart` only) back into the synced meal plan. This is the ONLY way the
// calendar touches `entries` — placement is device-local, but membership +
// totals stay synced so the grocery pipeline and nutrition keep working
// unchanged. Reconciling per recipe (rather than rebuilding the whole list)
// deliberately leaves untouched any entry that has no cell in any week — the
// "unscheduled" recipes shown on the Weekly Plan screen (e.g. a plan synced
// from another device).
function reconcileRecipes(
  cells: ScheduleCell[],
  weekStart: string,
  recipeIds: Iterable<string>
): void {
  const totals = sumServingsByRecipe(cells.filter((c) => c.weekStart === weekStart));
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
      selectedWeekStart: getWeekStart(),
      setSelectedWeek: (weekStart) => {
        const { cells, selectedWeekStart } = get();
        if (weekStart === selectedWeekStart) return;
        set({ selectedWeekStart: weekStart });
        // Re-project the plan entries onto the new week: recipes scheduled in
        // either week get their entry rebuilt from the new week's cells (added,
        // re-totaled, or removed when absent there).
        const affected = cells
          .filter((c) => c.weekStart === selectedWeekStart || c.weekStart === weekStart)
          .map((c) => c.recipeId);
        reconcileRecipes(cells, weekStart, affected);
      },
      assign: (day, slot, recipeId, desiredServings) => {
        const { selectedWeekStart } = get();
        const servings = Math.max(1, Math.round(desiredServings));
        const next = [
          ...get().cells,
          { id: uuid(), weekStart: selectedWeekStart, day, slot, recipeId, desiredServings: servings },
        ];
        set({ cells: next });
        reconcileRecipes(next, selectedWeekStart, [recipeId]);
      },
      removeCell: (id) => {
        const removed = get().cells.find((c) => c.id === id);
        if (!removed) return;
        const next = get().cells.filter((c) => c.id !== id);
        set({ cells: next });
        reconcileRecipes(next, removed.weekStart, [removed.recipeId]);
      },
      updateCellServings: (id, desiredServings) => {
        const servings = Math.max(1, Math.round(desiredServings));
        const target = get().cells.find((c) => c.id === id);
        if (!target) return;
        const next = get().cells.map((c) => (c.id === id ? { ...c, desiredServings: servings } : c));
        set({ cells: next });
        reconcileRecipes(next, target.weekStart, [target.recipeId]);
      },
      moveCell: (id, day, slot) => {
        // Moving keeps the recipe's total servings unchanged, so no reconcile.
        set((s) => ({ cells: s.cells.map((c) => (c.id === id ? { ...c, day, slot } : c)) }));
      },
      setFromPlanned: (placed) => {
        const { cells, selectedWeekStart } = get();
        const prevWeekCells = cells.filter((c) => c.weekStart === selectedWeekStart);
        const otherWeeks = cells.filter((c) => c.weekStart !== selectedWeekStart);
        const fresh = placed.map((p) => ({
          id: uuid(),
          weekStart: selectedWeekStart,
          day: p.day,
          slot: p.slot,
          recipeId: p.recipeId,
          desiredServings: Math.max(1, Math.round(p.desiredServings)),
        }));
        const next = [...otherWeeks, ...fresh];
        set({ cells: next });
        // Reconcile every recipe that appeared in the week's old OR new
        // placement so dropped recipes get their entry removed and new ones
        // get added. Other weeks' cells are untouched.
        const affected = [...prevWeekCells.map((c) => c.recipeId), ...fresh.map((c) => c.recipeId)];
        reconcileRecipes(next, selectedWeekStart, affected);
      },
      removeRecipe: (recipeId) => {
        const next = get().cells.filter((c) => c.recipeId !== recipeId);
        if (next.length !== get().cells.length) set({ cells: next });
        // Not reconcileRecipes: that leaves an entry with no cell alone (it may have
        // been synced from another device). Here the recipe is gone, so the entry goes too.
        useMealPlanStore.getState().removeEntry(recipeId);
      },
      clearSchedule: () => {
        const { cells, selectedWeekStart } = get();
        const cleared = cells.filter((c) => c.weekStart === selectedWeekStart);
        const next = cells.filter((c) => c.weekStart !== selectedWeekStart);
        set({ cells: next });
        reconcileRecipes(next, selectedWeekStart, cleared.map((c) => c.recipeId));
      },
    }),
    {
      name: STORAGE_KEYS.mealSchedule,
      storage: zustandStorage,
      version: 1,
      // v0 → v1: cells predate multi-week planning; stamp them all onto the
      // current week (the only week that existed) and select it.
      migrate: (persisted) => {
        const state = persisted as {
          cells?: Array<Omit<ScheduleCell, 'weekStart'> & { weekStart?: string }>;
          selectedWeekStart?: string;
        };
        const week = getWeekStart();
        return {
          ...state,
          selectedWeekStart: state.selectedWeekStart ?? week,
          cells: (state.cells ?? []).map((c) => ({ ...c, weekStart: c.weekStart ?? week })),
        };
      },
    }
  )
);
