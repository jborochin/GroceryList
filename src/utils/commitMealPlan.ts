import { Meal, Recipe } from '../types';
import { PlannerResult } from './mealPlanner';
import { deterministicRecipeId } from './deterministicId';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore, PlannedCell } from '../store/useMealScheduleStore';

export function recipeIdForMeal(mealId: string): string {
  return deterministicRecipeId(mealId);
}

function mealToRecipe(meal: Meal): Recipe {
  const now = Date.now();
  return {
    id: recipeIdForMeal(meal.id),
    title: meal.title,
    servings: meal.servings,
    ingredients: meal.ingredients,
    instructions: meal.instructions,
    nutritionPerServing: meal.nutritionPerServing,
    imageUrl: meal.imageUrl,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Materialize a single catalog meal into the user's recipe library (idempotent
 * via the deterministic id) and return its recipe id, ready to be placed on the
 * calendar. Used by the Weekly Plan "Browse catalog" picker.
 */
export function ensureRecipeForMeal(meal: Meal): string {
  const recipe = mealToRecipe(meal);
  useRecipeStore.getState().upsertRecipe(recipe);
  return recipe.id;
}

export interface CommitSummary {
  recipeCount: number;
  totalServings: number;
}

/**
 * Materialize a generated plan into the user's recipes + meal-plan calendar.
 *
 * Each unique chosen meal is cloned into the recipes store under a deterministic
 * UUIDv5 id (idempotent on re-generate). The planner's per-day/slot placement is
 * preserved into the device-local schedule (so the Weekly Plan calendar shows
 * exactly what the planner laid out); `setFromPlanned` then reconciles the synced
 * meal-plan entries (one per recipe, servings summed across its cells), keeping
 * the grocery and nutrition paths unchanged.
 */
export function commitPlannedMeals(result: PlannerResult, catalog: Meal[]): CommitSummary {
  const catalogById = new Map(catalog.map((m) => [m.id, m]));

  const recipeStore = useRecipeStore.getState();

  const seen = new Set<string>();
  const placed: PlannedCell[] = [];
  let totalServings = 0;
  for (const item of result.items) {
    const meal = catalogById.get(item.mealId);
    if (!meal) continue;
    const recipe = mealToRecipe(meal);
    if (!seen.has(recipe.id)) {
      recipeStore.upsertRecipe(recipe);
      seen.add(recipe.id);
    }
    placed.push({
      day: item.day,
      slot: item.slot,
      recipeId: recipe.id,
      desiredServings: item.servings,
    });
    totalServings += item.servings;
  }

  // Write the calendar cells; this also reconciles the synced plan entries.
  useMealScheduleStore.getState().setFromPlanned(placed);

  // Record the plan length so the daily nutrition view divides by the right
  // number of days instead of assuming a 7-day week.
  useMealPlanStore.getState().setPlanDays(result.dailyTotals.length);

  return { recipeCount: seen.size, totalServings };
}
