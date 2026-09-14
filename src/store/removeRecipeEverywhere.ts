import { useRecipeStore } from './useRecipeStore';
import { useMealScheduleStore } from './useMealScheduleStore';
import { useGroceryRecipeStore } from './useGroceryRecipeStore';
import { useFavoritesStore } from './useFavoritesStore';
import { useCookSessionStore } from './useCookSessionStore';
import { useMealDispositionStore } from './useMealDispositionStore';

/**
 * Delete a recipe and every reference to it.
 *
 * `useRecipeStore.deleteRecipe` alone leaves the plan entry, the calendar cells, the
 * grocery-only add, the favorite, the cook session and the deck disposition all
 * pointing at an id that no longer resolves. The aggregator and the nutrition
 * summary skip such entries, so the list and the totals silently shrink while the
 * Week grid keeps rendering a "Planned meal" placeholder forever. Every screen that
 * deletes a recipe goes through here.
 */
export function removeRecipeEverywhere(recipeId: string): void {
  // Schedule first: it also removes the synced plan entry.
  useMealScheduleStore.getState().removeRecipe(recipeId);
  useGroceryRecipeStore.getState().removeEntry(recipeId);
  useFavoritesStore.getState().removeFavorite(recipeId);
  useCookSessionStore.getState().end(recipeId);
  useMealDispositionStore.getState().clearDisposition(recipeId);
  useRecipeStore.getState().deleteRecipe(recipeId);
}
