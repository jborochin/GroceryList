import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ItemOverride } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

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
        const key = name.trim().toLowerCase();
        if (!key) return;
        set((s) => ({
          overrides: {
            ...s.overrides,
            [key]: { name: key, displayName: displayName.trim() || key, quantity, unit, category },
          },
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
      name: STORAGE_KEYS.itemOverrides,
      storage: zustandStorage,
    }
  )
);
