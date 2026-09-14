import { useEffect, useState } from 'react';
import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { useMealScheduleStore } from './useMealScheduleStore';
import { useMealDispositionStore } from './useMealDispositionStore';
import { usePantryStore } from './usePantryStore';
import { useManualItemStore } from './useManualItemStore';
import { useGroceryRecipeStore } from './useGroceryRecipeStore';
import { useDismissedItemStore } from './useDismissedItemStore';
import { useSettingsStore } from './useSettingsStore';
import { usePriceOverrideStore } from './usePriceOverrideStore';
import { useItemOverrideStore } from './useItemOverrideStore';
import { useAuthStore } from './useAuthStore';
import { useFavoritesStore } from './useFavoritesStore';
import { useFoodLogStore } from './useFoodLogStore';
import { useCustomFoodStore } from './useCustomFoodStore';
import { useCookSessionStore } from './useCookSessionStore';
import { hydrationFailed, onHydrationFailure } from './storage';
import { remapLegacyRecipeIds } from './remapLegacyRecipeIds';
import { getWeekStart } from '../utils/planningWeek';

const stores = [useRecipeStore, useMealPlanStore, useMealScheduleStore, useMealDispositionStore, usePantryStore, useManualItemStore, useGroceryRecipeStore, useDismissedItemStore, useSettingsStore, usePriceOverrideStore, useItemOverrideStore, useFavoritesStore, useFoodLogStore, useCustomFoodStore, useCookSessionStore];

/**
 * Upper bound on how long the launch spinner may wait for AsyncStorage. Hydration
 * normally completes in tens of milliseconds; if something has gone wrong that the
 * failure registry didn't catch (a storage backend that never resolves), the app
 * proceeds with whatever loaded rather than spinning until the user gives up.
 */
const HYDRATION_FALLBACK_MS = 4000;

function storeDone(s: (typeof stores)[number]): boolean {
  // A store whose persisted blob was corrupt never reports hasHydrated — zustand's
  // persist middleware skips that on error — but storage.ts records the failure
  // (and drops the bad key), and its in-memory defaults are perfectly usable.
  return s.persist.hasHydrated() || hydrationFailed(s.persist.getOptions().name ?? '');
}

export function useHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const authInitialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    let mounted = true;
    let done = false;
    const finish = () => {
      if (done || !mounted) return;
      done = true;
      // Legacy slug ids first: the week reconcile below rebuilds plan entries
      // from cell recipe ids, and must see the rewritten ones.
      remapLegacyRecipeIds();
      // A selected planning week left in the past is stale — snap back to the
      // current week (week keys are ISO dates, so string order = date order).
      // setSelectedWeek re-projects the synced plan entries onto that week,
      // which is why this must wait until every store has hydrated.
      const schedule = useMealScheduleStore.getState();
      const currentWeek = getWeekStart();
      if (schedule.selectedWeekStart < currentWeek) {
        schedule.setSelectedWeek(currentWeek);
      }
      // A cook session left open for a day was abandoned, not paused — drop
      // it so the recipe offers "Cook" again rather than resuming a stale list.
      useCookSessionStore.getState().pruneStale(Date.now());
      setHydrated(true);
    };
    const check = () => {
      if (stores.every(storeDone)) finish();
    };
    check();
    const unsubs = [
      ...stores.map((s) => s.persist.onFinishHydration(check)),
      onHydrationFailure(check),
    ];
    const fallback = setTimeout(finish, HYDRATION_FALLBACK_MS);
    return () => {
      mounted = false;
      clearTimeout(fallback);
      unsubs.forEach((u) => u());
    };
  }, []);

  return hydrated && authInitialized;
}
