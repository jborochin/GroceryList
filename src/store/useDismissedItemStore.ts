import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface DismissedState {
  names: string[];
  dismiss: (name: string) => void;
  restore: (name: string) => void;
  prune: (validNames: string[]) => void;
  clearAll: () => void;
}

export const useDismissedItemStore = create<DismissedState>()(
  persist(
    (set) => ({
      names: [],
      dismiss: (name) => {
        set((s) => (s.names.includes(name) ? s : { names: [...s.names, name] }));
      },
      restore: (name) => {
        set((s) => ({ names: s.names.filter((n) => n !== name) }));
      },
      prune: (validNames) => {
        const valid = new Set(validNames);
        set((s) => {
          const next = s.names.filter((n) => valid.has(n));
          // Bail when nothing changed to avoid needless re-renders / update loops.
          return next.length === s.names.length ? s : { names: next };
        });
      },
      clearAll: () => set({ names: [] }),
    }),
    {
      name: STORAGE_KEYS.dismissedItems,
      storage: zustandStorage,
    }
  )
);
