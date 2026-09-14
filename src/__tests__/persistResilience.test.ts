import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEYS,
  hydrationFailed,
  onHydrationFailure,
  __resetHydrationFailures,
} from '../store/storage';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { usePantryStore } from '../store/usePantryStore';
import { useCookSessionStore } from '../store/useCookSessionStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetHydrationFailures();
});

describe('a corrupt persisted blob', () => {
  it('is reported as a hydration failure and removed, instead of hanging hydration', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.recipes, '{"state":{"recipes":[');
    const seen: string[] = [];
    const off = onHydrationFailure((name) => seen.push(name));

    await useRecipeStore.persist.rehydrate();

    expect(hydrationFailed(STORAGE_KEYS.recipes)).toBe(true);
    expect(seen).toEqual([STORAGE_KEYS.recipes]);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.recipes)).toBeNull();
    // The store is usable with its defaults.
    expect(useRecipeStore.getState().recipes).toEqual([]);
    off();
  });
});

describe('persisted shape sanitizing on hydrate', () => {
  it('drops recipes whose shape an older build could have written', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.recipes,
      JSON.stringify({
        state: {
          recipes: [
            { id: 'good', title: 'ok', servings: 2, ingredients: [], createdAt: 1, updatedAt: 1 },
            { id: 'legacy', title: 'strings', servings: 2, ingredients: ['1 cup flour'] },
            null,
            'junk',
          ],
        },
        version: 0,
      })
    );
    await useRecipeStore.persist.rehydrate();
    expect(useRecipeStore.getState().recipes.map((r) => r.id)).toEqual(['good']);
  });

  it('keeps only array-shaped entries for the food log and pantry', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.foodLog,
      JSON.stringify({ state: { entries: { not: 'an array' } }, version: 0 })
    );
    await AsyncStorage.setItem(
      STORAGE_KEYS.pantry,
      JSON.stringify({ state: { items: [{ id: 'p1', name: 'salt' }, { name: 'no id' }, 3] }, version: 0 })
    );
    await useFoodLogStore.persist.rehydrate();
    await usePantryStore.persist.rehydrate();
    expect(useFoodLogStore.getState().entries).toEqual([]);
    expect(usePantryStore.getState().items).toEqual([{ id: 'p1', name: 'salt' }]);
  });

  it('drops cook sessions that are not objects keyed by recipe id', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.cookSessions,
      JSON.stringify({ state: { sessions: [1, 2, 3] }, version: 0 })
    );
    await useCookSessionStore.persist.rehydrate();
    expect(useCookSessionStore.getState().sessions).toEqual({});
  });
});
