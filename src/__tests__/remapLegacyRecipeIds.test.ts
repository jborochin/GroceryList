import { remapLegacyRecipeIds } from '../store/remapLegacyRecipeIds';
import { deterministicRecipeId } from '../utils/deterministicId';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useGroceryRecipeStore } from '../store/useGroceryRecipeStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useCookSessionStore } from '../store/useCookSessionStore';

const LEGACY = 'seed-sheet-pan-chicken';
const NEW = deterministicRecipeId(LEGACY);

beforeEach(() => {
  useRecipeStore.setState({
    recipes: [{ id: LEGACY, title: 'Chicken', servings: 2, ingredients: [], createdAt: 0, updatedAt: 0 }],
  });
  useMealPlanStore.setState({ entries: [{ recipeId: LEGACY, desiredServings: 2 }] });
  useMealScheduleStore.setState({
    cells: [{ id: 'c1', weekStart: '2026-09-07', day: 0, slot: 'dinner', recipeId: LEGACY, desiredServings: 2 }],
  });
  useGroceryRecipeStore.setState({ entries: [{ recipeId: LEGACY, desiredServings: 2 }] });
  useFavoritesStore.setState({ favoriteIds: [LEGACY, 'other'] });
  useCookSessionStore.setState({
    sessions: {
      [LEGACY]: {
        recipeId: LEGACY,
        title: 'Chicken',
        servings: 2,
        checkedIngredients: [],
        checkedSteps: [],
        ingredientCount: 0,
        stepCount: 0,
        timers: [],
        startedAt: 0,
        updatedAt: 0,
      },
    },
  });
});

describe('remapLegacyRecipeIds', () => {
  it('rewrites the legacy id in every store that references a recipe', () => {
    remapLegacyRecipeIds();
    expect(useRecipeStore.getState().recipes[0].id).toBe(NEW);
    expect(useMealPlanStore.getState().entries[0].recipeId).toBe(NEW);
    expect(useMealScheduleStore.getState().cells[0].recipeId).toBe(NEW);
    expect(useGroceryRecipeStore.getState().entries[0].recipeId).toBe(NEW);
    expect(useFavoritesStore.getState().favoriteIds).toEqual([NEW, 'other']);
    const sessions = useCookSessionStore.getState().sessions;
    expect(Object.keys(sessions)).toEqual([NEW]);
    expect(sessions[NEW].recipeId).toBe(NEW);
  });

  it('is a no-op when every id is already a uuid', () => {
    remapLegacyRecipeIds();
    const before = useMealScheduleStore.getState().cells;
    remapLegacyRecipeIds();
    expect(useMealScheduleStore.getState().cells).toBe(before);
  });
});
