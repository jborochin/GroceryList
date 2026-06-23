import { CookingFrequency, Meal, MealSlot, NutritionPerServing, Recipe } from '../types';
import { planMeals, PlannerResult, PlannerTargets, SlotConfig } from './mealPlanner';
import { DeckCard } from './mealDeck';
import { deterministicRecipeId } from './deterministicId';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore, PlannedCell } from '../store/useMealScheduleStore';

const ALL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const EMPTY_NUTRITION: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

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

// Adapt a deck card into the Meal shape the planner consumes. Catalog cards
// resolve to their full catalog meal; recipe cards become a synthetic meal that
// is eligible for every slot (recipes carry no slot/cuisine metadata) and is
// macro-scored on whatever nutrition the recipe has.
function cardToPlannableMeal(
  card: DeckCard,
  catalogById: Map<string, Meal>,
  recipeById: Map<string, Recipe>
): Meal | null {
  if (card.source === 'catalog') {
    return catalogById.get(card.id) ?? null;
  }
  const recipe = recipeById.get(card.id);
  if (!recipe) return null;
  return {
    id: recipe.id,
    title: recipe.title,
    cuisine: '',
    slots: ALL_SLOTS,
    dietaryTags: [],
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    nutritionPerServing: recipe.nutritionPerServing ?? EMPTY_NUTRITION,
    imageUrl: recipe.imageUrl,
    instructions: recipe.instructions,
  };
}

export interface ArrangeChosenInput {
  cards: DeckCard[]; // the meals the user swiped up ("this week")
  catalog: Meal[];
  recipes: Recipe[];
  days: number;
  slots: SlotConfig[];
  targets: PlannerTargets;
  cuisinePreferences: string[];
  cookingFrequency?: CookingFrequency;
}

export interface ArrangeChosenSummary {
  recipeCount: number;
  unfilledSlots: number;
}

/**
 * Auto-arrange a user-curated pool of meals into the week and commit it.
 *
 * The user already triaged for diet by swiping, so the planner runs with no
 * dietary filter over ONLY the chosen pool — it just distributes those meals
 * across the configured day/slot grid to best hit macro targets (repeating
 * meals when the pool is smaller than the grid; leaving slots unfilled when no
 * chosen meal fits). Placement then flows through the same `setFromPlanned`
 * reconciliation as the auto-planner, so grocery + nutrition stay unchanged.
 */
export function arrangeAndCommitChosen(input: ArrangeChosenInput): ArrangeChosenSummary {
  const catalogById = new Map(input.catalog.map((m) => [m.id, m]));
  const recipeById = new Map(input.recipes.map((r) => [r.id, r]));

  const plannableMeals: Meal[] = [];
  for (const card of input.cards) {
    const meal = cardToPlannableMeal(card, catalogById, recipeById);
    if (meal) plannableMeals.push(meal);
  }

  const result = planMeals({
    targets: input.targets,
    cuisinePreferences: input.cuisinePreferences,
    dietaryRestrictions: [],
    cookingFrequency: input.cookingFrequency,
    meals: plannableMeals,
    days: input.days,
    slots: input.slots,
  });

  const recipeStore = useRecipeStore.getState();
  const seen = new Set<string>();
  const placed: PlannedCell[] = [];
  for (const item of result.items) {
    // item.mealId is a catalog slug (clone into recipes) or an existing
    // recipe id (use directly).
    const catalogMeal = catalogById.get(item.mealId);
    let recipeId: string;
    if (catalogMeal) {
      const recipe = mealToRecipe(catalogMeal);
      recipeId = recipe.id;
      if (!seen.has(recipeId)) {
        recipeStore.upsertRecipe(recipe);
        seen.add(recipeId);
      }
    } else {
      recipeId = item.mealId;
      seen.add(recipeId);
    }
    placed.push({ day: item.day, slot: item.slot, recipeId, desiredServings: item.servings });
  }

  useMealScheduleStore.getState().setFromPlanned(placed);
  useMealPlanStore.getState().setPlanDays(result.dailyTotals.length);

  return { recipeCount: seen.size, unfilledSlots: result.unfilledSlots };
}
