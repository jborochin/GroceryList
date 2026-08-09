import { create } from 'zustand';

/**
 * A version counter that ticks whenever the live price overlay changes.
 *
 * findPrice() reads the overlay through a synchronous module-level cache, so
 * filling that cache is invisible to React. The grocery pipeline runs inside
 * `useMemo` in HomeScreen and GroceryListScreen; including this version in
 * their dep arrays is what makes prices recompute once a refresh lands.
 *
 * Deliberately NOT persisted — it describes this session only, so it must not
 * be added to the store list in hydration.ts.
 */
interface PriceCatalogState {
  version: number;
  bump: () => void;
}

export const usePriceCatalogStore = create<PriceCatalogState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
