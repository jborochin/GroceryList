import { useEffect, useState } from 'react';
import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { usePantryStore } from './usePantryStore';
import { useManualItemStore } from './useManualItemStore';
import { useDismissedItemStore } from './useDismissedItemStore';
import { useSettingsStore } from './useSettingsStore';
import { usePriceOverrideStore } from './usePriceOverrideStore';
import { useAuthStore } from './useAuthStore';

const stores = [useRecipeStore, useMealPlanStore, usePantryStore, useManualItemStore, useDismissedItemStore, useSettingsStore, usePriceOverrideStore];

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
      if (allHydrated && mounted) setHydrated(true);
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
