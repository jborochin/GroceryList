import { Meal, Recipe } from '../types';
import { PlannerResult } from './mealPlanner';
import { deterministicRecipeId } from './deterministicId';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';

export function recipeIdForMeal(mealId: string): string {
  return deterministicRecipeId(mealId);
}

// Clone a shared-catalog meal into a user Recipe. The id is deterministic
// (UUIDv5 from the meal slug), so upserting the same meal twice updates in place
// rather than creating a duplicate. Shared by the planner-commit path and the
// "Add to my recipes" browse flow.
export function mealToRecipe(meal: Meal): Recipe {
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

export interface CommitSummary {
  recipeCount: number;
  totalServings: number;
}

/**
 * Materialize a generated plan into the user's recipes + meal plan.
 *
 * Each unique chosen meal is cloned into the recipes store under a deterministic
 * UUIDv5 id (idempotent on re-generate) and added as a single meal-plan entry.
 * `useMealPlanStore.addEntry` REPLACES the serving count for an existing recipe,
 * so we pre-sum servings across every day/slot the meal appears in and call it
 * once — never once per slot. This reuses the existing sync, grocery and
 * nutrition paths with no changes.
 */
export function commitPlannedMeals(result: PlannerResult, catalog: Meal[]): CommitSummary {
  const catalogById = new Map(catalog.map((m) => [m.id, m]));

  // Sum servings per unique meal across all day/slot occurrences.
  const servingsByMeal = new Map<string, number>();
  for (const item of result.items) {
    servingsByMeal.set(item.mealId, (servingsByMeal.get(item.mealId) ?? 0) + item.servings);
  }

  const recipeStore = useRecipeStore.getState();
  const planStore = useMealPlanStore.getState();

  let totalServings = 0;
  for (const [mealId, servings] of servingsByMeal) {
    const meal = catalogById.get(mealId);
    if (!meal) continue;
    const recipe = mealToRecipe(meal);
    recipeStore.upsertRecipe(recipe);
    planStore.addEntry(recipe.id, servings);
    totalServings += servings;
  }

  // Record the plan length so the daily nutrition view divides by the right
  // number of days instead of assuming a 7-day week.
  planStore.setPlanDays(result.dailyTotals.length);

  return { recipeCount: servingsByMeal.size, totalServings };
}
