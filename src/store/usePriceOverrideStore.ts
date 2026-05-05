import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PriceOverride } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

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
        const key = name.trim().toLowerCase();
        if (!key) return;
        set((s) => ({
          overrides: { ...s.overrides, [key]: { name: key, pricePerUnit, unit } },
        }));
      },
      removeOverride: (name) => {
        const key = name.trim().toLowerCase();
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
