import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PriceOverride } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';
import { canonicalizeUnit } from '../utils/ingredientParser';
import { normalizeName } from '../utils/normalizeName';

interface PriceOverrideState {
  overrides: Record<string, PriceOverride>;
  setOverride: (name: string, pricePerUnit: number, unit: string) => void;
  removeOverride: (name: string) => void;
  clear: () => void;
}

export const usePriceOverrideStore = create<PriceOverrideState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (name, pricePerUnit, unit) => {
        const key = normalizeName(name);
        if (!key) return;
        // findPrice returns this entry verbatim, so a raw "lbs" here makes every
        // conversion to it fail and the item the user just priced goes unpriced.
        if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) return;
        set((s) => ({
          overrides: {
            ...s.overrides,
            [key]: { name: key, pricePerUnit, unit: canonicalizeUnit(unit) },
          },
        }));
      },
      removeOverride: (name) => {
        const key = normalizeName(name);
        set((s) => {
          const copy = { ...s.overrides };
          delete copy[key];
          return { overrides: copy };
        });
      },
      clear: () => set({ overrides: {} }),
    }),
    {
      name: STORAGE_KEYS.priceOverrides,
      storage: zustandStorage,
    }
  )
);
