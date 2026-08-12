import {
  FoodLogEntry,
  MealSlot,
  NutritionPerServing,
  Recipe,
  ScheduleCell,
} from '../types';
import { dateKeyToCell } from './planningWeek';

// Merge the meal *plan* (what you intend to eat) with the food *log* (what you
// actually ate) into one day's worth of rows.
//
// The plan is already a prediction of the log: a planned dinner is a dinner you
// expect to eat. So a planned meal counts toward the day's totals the moment it
// is planned, rendered as `projected`, and confirming it only sharpens the
// number rather than creating it. A day you forget to open still reads
// correctly.
//
// A plan cell stops projecting once a log entry answers it, either way:
//   fromCellId    — you ate the planned meal ("Ate this")
//   replacesCellId — you ate something else instead ("Ate other")
// In both cases the cell itself survives untouched, because the grocery list is
// built from cells and those ingredients were already bought. Nothing in this
// file mutates a store.

export const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const ZERO_NUTRITION: NutritionPerServing = {
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
};

export type DayRowStatus = 'logged' | 'projected';

export interface DayRow {
  key: string;
  status: DayRowStatus;
  slot: MealSlot;
  title: string;
  /** Second line: brand, or the serving/servings description. */
  detail?: string;
  nutrition: NutritionPerServing;
  /** Present on `logged` rows — the entry to edit or delete. */
  entry?: FoodLogEntry;
  /** Present on `projected` rows — the plan cell to confirm or replace. */
  cell?: ScheduleCell;
  /** Present on `projected` rows when the recipe still exists. */
  recipe?: Recipe;
}

export interface DaySummary {
  date: string;
  bySlot: Record<MealSlot, DayRow[]>;
  /** Everything on the day: logged plus still-projected. */
  totals: NutritionPerServing;
  /** The projected share of `totals`, so the UI can mark it as an estimate. */
  projected: NutritionPerServing;
  hasProjected: boolean;
  /** A planned meal whose recipe has since been deleted can't be counted. */
  hasMissingRecipe: boolean;
}

export function addNutrition(
  a: NutritionPerServing,
  b: NutritionPerServing
): NutritionPerServing {
  return {
    calories: a.calories + b.calories,
    proteinG: a.proteinG + b.proteinG,
    carbsG: a.carbsG + b.carbsG,
    fatG: a.fatG + b.fatG,
  };
}

export function scaleNutrition(n: NutritionPerServing, factor: number): NutritionPerServing {
  return {
    calories: n.calories * factor,
    proteinG: n.proteinG * factor,
    carbsG: n.carbsG * factor,
    fatG: n.fatG * factor,
  };
}

/** What a planned cell contributes if eaten as planned. */
export function nutritionForCell(
  cell: ScheduleCell,
  recipe: Recipe | undefined
): NutritionPerServing | null {
  if (!recipe?.nutritionPerServing) return null;
  return scaleNutrition(recipe.nutritionPerServing, cell.desiredServings);
}

function emptySlots(): Record<MealSlot, DayRow[]> {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

/**
 * Build one day's rows and totals.
 *
 * `cells` and `entries` may be the whole stores — this filters to `date` itself
 * so callers don't each reimplement the week/day addressing.
 */
export function resolveDay(
  date: string,
  cells: ScheduleCell[],
  entries: FoodLogEntry[],
  recipes: Recipe[]
): DaySummary {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const { weekStart, day } = dateKeyToCell(date);

  const dayEntries = entries.filter((e) => e.date === date);
  const dayCells = cells.filter((c) => c.weekStart === weekStart && c.day === day);

  // Cells already answered by a log entry — either confirmed or replaced.
  // Collected across ALL entries, not just this day's: a meal logged one day
  // late still answers its cell.
  const answered = new Set<string>();
  for (const e of entries) {
    if (e.fromCellId) answered.add(e.fromCellId);
    if (e.replacesCellId) answered.add(e.replacesCellId);
  }

  const bySlot = emptySlots();
  let totals = ZERO_NUTRITION;
  let projected = ZERO_NUTRITION;
  let hasMissingRecipe = false;

  for (const entry of dayEntries) {
    bySlot[entry.slot].push({
      key: entry.id,
      status: 'logged',
      slot: entry.slot,
      title: entry.displayName,
      detail: loggedDetail(entry),
      nutrition: entry.nutrition,
      entry,
    });
    totals = addNutrition(totals, entry.nutrition);
  }

  for (const cell of dayCells) {
    if (answered.has(cell.id)) continue;
    const recipe = recipeById.get(cell.recipeId);
    const nutrition = nutritionForCell(cell, recipe);
    if (!recipe || !nutrition) {
      // Still show the row so the user can act on it; it just contributes 0 and
      // flags the day as understated.
      hasMissingRecipe = true;
    }
    bySlot[cell.slot].push({
      key: cell.id,
      status: 'projected',
      slot: cell.slot,
      title: recipe?.title ?? 'Planned meal',
      detail: `${cell.desiredServings} ${cell.desiredServings === 1 ? 'serving' : 'servings'}`,
      nutrition: nutrition ?? ZERO_NUTRITION,
      cell,
      recipe,
    });
    if (nutrition) {
      totals = addNutrition(totals, nutrition);
      projected = addNutrition(projected, nutrition);
    }
  }

  // Logged first within a slot, then planned — the day reads as settled-then-
  // pending. Logged rows keep insertion order (creation order); planned rows
  // keep the order the schedule stored them in.
  for (const slot of SLOT_ORDER) {
    bySlot[slot].sort((a, b) => rank(a.status) - rank(b.status));
  }

  return {
    date,
    bySlot,
    totals,
    projected,
    hasProjected: projected.calories > 0 || projected.proteinG > 0,
    hasMissingRecipe,
  };
}

function rank(status: DayRowStatus): number {
  return status === 'logged' ? 0 : 1;
}

function loggedDetail(entry: FoodLogEntry): string {
  const qty = formatServingQty(entry.servingQty);
  const serving = `${qty} ${entry.servingLabel}`.trim();
  return entry.brand ? `${entry.brand} · ${serving}` : serving;
}

/** Trim a serving count to at most two decimals without trailing zeroes. */
export function formatServingQty(qty: number): string {
  if (!Number.isFinite(qty)) return '0';
  return String(Math.round(qty * 100) / 100);
}
