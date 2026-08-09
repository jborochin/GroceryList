import { Meal, MealSlot, NutritionPerServing, Recipe } from '../types';
import { Disposition } from '../store/useMealDispositionStore';
import { catalogCloneIdSet } from './deterministicId';
import { mealFitScore, PlannerTargets } from './mealPlanner';

// A single swipeable cookbook page. `id` is the placement key: a catalog meal
// slug (source 'catalog') or a user recipe id (source 'recipe') — both globally
// unique, so dispositions key off it directly.
export interface DeckCard {
  id: string;
  source: 'catalog' | 'recipe';
  title: string;
  imageUrl?: string;
  cuisine?: string;
  nutrition?: NutritionPerServing;
  slots: MealSlot[];
}

const ALL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function catalogCard(meal: Meal): DeckCard {
  return {
    id: meal.id,
    source: 'catalog',
    title: meal.title,
    imageUrl: meal.imageUrl,
    cuisine: meal.cuisine,
    nutrition: meal.nutritionPerServing,
    slots: meal.slots,
  };
}

function recipeCard(recipe: Recipe): DeckCard {
  return {
    id: recipe.id,
    source: 'recipe',
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    nutrition: recipe.nutritionPerServing,
    slots: ALL_SLOTS,
  };
}

/**
 * Build the cookbook swipe deck from the catalog + the user's own recipes.
 *
 * - Catalog meals committed to the plan are cloned into recipes under a
 *   deterministic id; those clones are dropped so a meal never appears twice
 *   (the richer catalog card wins).
 * - 'rejected' (torn-out) cards are excluded entirely.
 * - 'later' (flipped) cards are kept but sorted *after* fresh cards, so a
 *   deferred meal resurfaces in future decks without crowding the front.
 * - Within each bucket, cards order best-fit-first against the daily macro
 *   target (protein-weighted); cards without nutrition sort last. Ties break by
 *   id so the deck is deterministic.
 */
export function buildMealDeck(
  catalog: Meal[],
  recipes: Recipe[],
  dispositions: Record<string, Disposition>,
  targets: PlannerTargets
): DeckCard[] {
  const catalogCloneIds = catalogCloneIdSet(catalog.map((m) => m.id));

  const cards: DeckCard[] = [
    ...catalog.map(catalogCard),
    ...recipes.filter((r) => !catalogCloneIds.has(r.id)).map(recipeCard),
  ];

  const fresh: DeckCard[] = [];
  const later: DeckCard[] = [];
  for (const card of cards) {
    const d = dispositions[card.id];
    if (d === 'rejected') continue;
    if (d === 'later') later.push(card);
    else fresh.push(card);
  }

  const byFit = (a: DeckCard, b: DeckCard) => {
    const sa = a.nutrition ? mealFitScore(a.nutrition, targets) : -Infinity;
    const sb = b.nutrition ? mealFitScore(b.nutrition, targets) : -Infinity;
    if (sb !== sa) return sb - sa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  fresh.sort(byFit);
  later.sort(byFit);

  return [...fresh, ...later];
}
