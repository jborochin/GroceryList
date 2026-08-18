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
import { getWeekStart } from '../utils/planningWeek';

const stores = [useRecipeStore, useMealPlanStore, useMealScheduleStore, useMealDispositionStore, usePantryStore, useManualItemStore, useGroceryRecipeStore, useDismissedItemStore, useSettingsStore, usePriceOverrideStore, useItemOverrideStore, useFavoritesStore, useFoodLogStore, useCustomFoodStore, useCookSessionStore];

export function useHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const authInitialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    let mounted = true;
    const check = () => {
      const allHydrated = stores.every((s) => s.persist.hasHydrated());
      if (allHydrated && mounted) {
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
      }
    };
    check();
    const unsubs = stores.map((s) => s.persist.onFinishHydration(check));
    return () => {
      mounted = false;
      unsubs.forEach((u) => u());
    };
  }, []);

  return hydrated && authInitialized;
}
