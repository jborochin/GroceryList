import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

const jsonStorage = createJSONStorage(() => AsyncStorage)!;

/**
 * AsyncStorage-backed JSON storage for every persisted store, with one change from
 * the stock adapter: a `getItem` that cannot parse what it finds reports the key
 * (see the failure registry below), drops it, and returns null. zustand then takes
 * its normal "nothing persisted" path — the store hydrates with defaults and
 * `hasHydrated()` flips — instead of the error path, which never marks the store
 * hydrated and would leave the launch spinner up for good.
 */
export const zustandStorage: typeof jsonStorage = {
  ...jsonStorage,
  getItem: async (name) => {
    try {
      return await jsonStorage.getItem(name);
    } catch {
      recordFailure(name);
      return null;
    }
  },
};

export const STORAGE_KEYS = {
  recipes: 'mealprep/recipes/v1',
  mealPlan: 'mealprep/mealPlan/v1',
  mealSchedule: 'mealprep/mealSchedule/v1',
  mealDisposition: 'mealprep/mealDisposition/v1',
  pantry: 'mealprep/pantry/v1',
  manualItems: 'mealprep/manualItems/v1',
  groceryRecipes: 'mealprep/groceryRecipes/v1',
  dismissedItems: 'mealprep/dismissedItems/v1',
  settings: 'mealprep/settings/v1',
  priceOverrides: 'mealprep/priceOverrides/v1',
  itemOverrides: 'mealprep/itemOverrides/v1',
  foodLog: 'mealprep/foodLog/v1',
  customFoods: 'mealprep/customFoods/v1',
  cookSessions: 'mealprep/cookSessions/v1',
  seeded: 'mealprep/seeded/v1',
  lastSyncedAt: 'mealprep/sync/lastSyncedAt/v1',
  outbox: 'mealprep/sync/outbox/v1',
  migratedAccountId: 'mealprep/sync/migratedAccountId/v1',
  mealCatalogCache: 'mealprep/mealCatalog/v1',
  priceCache: 'mealprep/priceCache/v1',
  favorites: 'mealprep/favorites/v1',
} as const;

// ---------------------------------------------------------------------------
// Hydration failure registry
//
// zustand's persist middleware never marks a store hydrated when getItem /
// JSON.parse / migrate throws: the promise lands in a `.catch` that only calls
// onRehydrateStorage's callback, without setting `_hasHydrated` or firing the
// finish listeners. useHydration() waits on every store, so one truncated blob
// (an interrupted write, a full disk) used to mean a spinner forever, with a
// reinstall as the only way out. The storage adapter above intercepts the
// failure before zustand sees it; this registry records which key it was (and
// removes it, so the next launch is clean) and lets useHydration observe it.
// ---------------------------------------------------------------------------

const failed = new Set<string>();
const failureListeners = new Set<(name: string) => void>();

export function hydrationFailed(name: string): boolean {
  return failed.has(name);
}

export function onHydrationFailure(cb: (name: string) => void): () => void {
  failureListeners.add(cb);
  return () => {
    failureListeners.delete(cb);
  };
}

/** Test seam. */
export function __resetHydrationFailures(): void {
  failed.clear();
}

function recordFailure(name: string): void {
  failed.add(name);
  // Best-effort: the in-memory defaults are already in place either way.
  AsyncStorage.removeItem(name).catch(() => undefined);
  for (const cb of failureListeners) cb(name);
}

/**
 * Keep only the entries of a persisted array that pass `isValid`; anything that
 * isn't an array at all becomes empty. For the `merge` option of list-shaped
 * stores, so a blob written by an older build with a different element shape
 * (recipes whose `ingredients` were strings) is dropped at hydrate rather than
 * crashing the first screen that maps over it.
 */
export function sanitizeList<T>(value: unknown, isValid: (x: unknown) => x is T): T[] {
  return Array.isArray(value) ? value.filter(isValid) : [];
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
