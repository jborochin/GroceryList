import { ScheduleCell } from '../types';

/**
 * Collapse the calendar (per day/slot placement) down to the flat
 * per-recipe serving totals that the synced meal plan understands.
 *
 * A recipe can appear in several cells (e.g. the same meal on Tue dinner and
 * Thu lunch); the meal plan only tracks one entry per recipe, so we sum the
 * servings across every cell that references it. This is the bridge that keeps
 * the grocery pipeline + nutrition + sync correct without them knowing about
 * days or slots.
 */
export function sumServingsByRecipe(cells: ScheduleCell[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const cell of cells) {
    totals.set(cell.recipeId, (totals.get(cell.recipeId) ?? 0) + cell.desiredServings);
  }
  return totals;
}
