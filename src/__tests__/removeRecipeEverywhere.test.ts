import { removeRecipeEverywhere } from '../store/removeRecipeEverywhere';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useGroceryRecipeStore } from '../store/useGroceryRecipeStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useCookSessionStore } from '../store/useCookSessionStore';
import { useMealDispositionStore } from '../store/useMealDispositionStore';

// AsyncStorage is the official jest mock (package.json moduleNameMapper), so the
// persisted stores run against an in-memory backend here.

beforeEach(() => {
  useRecipeStore.setState({ recipes: [] });
  useMealPlanStore.setState({ entries: [] });
  useMealScheduleStore.setState({ cells: [] });
  useGroceryRecipeStore.setState({ entries: [] });
  useFavoritesStore.setState({ favoriteIds: [] });
  useCookSessionStore.setState({ sessions: {} });
  useMealDispositionStore.setState({ dispositions: {} });
});

function seed(id: string) {
  useRecipeStore.getState().upsertRecipe({
    id,
    title: id,
    servings: 2,
    ingredients: [{ name: 'egg', quantity: 2, unit: 'each' }],
    createdAt: 0,
    updatedAt: 0,
  });
  useMealScheduleStore.getState().assign(0, 'dinner', id, 2);
  useGroceryRecipeStore.getState().addEntry(id, 2);
  useFavoritesStore.getState().toggleFavorite(id);
  useCookSessionStore.getState().ensure({
    recipeId: id,
    title: id,
    servings: 2,
    ingredientCount: 1,
    stepCount: 0,
  });
  useMealDispositionStore.getState().setDisposition(id, 'later');
}

describe('removeRecipeEverywhere', () => {
  it('removes the recipe and every reference to it', () => {
    seed('r1');
    // Sanity: the schedule assign projected a synced plan entry.
    expect(useMealPlanStore.getState().entries).toEqual([{ recipeId: 'r1', desiredServings: 2 }]);

    removeRecipeEverywhere('r1');

    expect(useRecipeStore.getState().recipes).toEqual([]);
    expect(useMealPlanStore.getState().entries).toEqual([]);
    expect(useMealScheduleStore.getState().cells).toEqual([]);
    expect(useGroceryRecipeStore.getState().entries).toEqual([]);
    expect(useFavoritesStore.getState().favoriteIds).toEqual([]);
    expect(useCookSessionStore.getState().sessions).toEqual({});
    expect(useMealDispositionStore.getState().dispositions).toEqual({});
  });

  it('leaves other recipes untouched', () => {
    seed('r1');
    seed('r2');
    removeRecipeEverywhere('r1');
    expect(useRecipeStore.getState().recipes.map((r) => r.id)).toEqual(['r2']);
    expect(useMealPlanStore.getState().entries).toEqual([{ recipeId: 'r2', desiredServings: 2 }]);
    expect(useMealScheduleStore.getState().cells.map((c) => c.recipeId)).toEqual(['r2']);
    expect(useGroceryRecipeStore.getState().entries.map((e) => e.recipeId)).toEqual(['r2']);
    expect(useFavoritesStore.getState().favoriteIds).toEqual(['r2']);
  });
});
