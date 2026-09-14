import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ItemOverride } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';
import { canonicalizeUnit } from '../utils/ingredientParser';
import { normalizeName } from '../utils/normalizeName';

interface ItemOverrideState {
  overrides: Record<string, ItemOverride>;
  setOverride: (
    name: string,
    displayName: string,
    quantity: number,
    unit: string,
    category: string
  ) => void;
  removeOverride: (name: string) => void;
  clear: () => void;
}

export const useItemOverrideStore = create<ItemOverrideState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (name, displayName, quantity, unit, category) => {
        // Same join key as every other per-item store: normalizeName, not a bare lowercase.
        const key = normalizeName(name);
        if (!key) return;
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        // A typed "lbs"/"cups" isn't in UNIT_TABLE; left raw it turns the row into a silent
        // unit-conflict and drops its price from the total. Canonicalize at the boundary.
        const canonicalUnit = canonicalizeUnit(unit);
        set((s) => ({
          overrides: {
            ...s.overrides,
            [key]: {
              name: key,
              displayName: displayName.trim() || key,
              quantity,
              unit: canonicalUnit,
              category,
            },
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
      name: STORAGE_KEYS.itemOverrides,
      storage: zustandStorage,
    }
  )
);
