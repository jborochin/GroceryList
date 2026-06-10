import 'react-native-get-random-values';
import { v5 as uuidv5 } from 'uuid';
import { Meal, Recipe } from '../types';
import { PlannerResult } from './mealPlanner';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';

// Fixed namespace so a meal slug always maps to the same recipe UUID. recipes.id
// is a `uuid` column in Supabase — a raw "meal:<slug>" id would pass offline but
// fail the server upsert and rot in the outbox, so we derive a valid UUIDv5.
// NEVER change this namespace or a catalog slug; doing so orphans committed plans.
const MEAL_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

export function recipeIdForMeal(mealId: string): string {
  return uuidv5(mealId, MEAL_NAMESPACE);
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

  return { recipeCount: servingsByMeal.size, totalServings };
}
