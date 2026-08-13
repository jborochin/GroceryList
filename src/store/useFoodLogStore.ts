import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { FoodLogEntry } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

// What the user actually ate. Synced (see src/lib/sync.ts) — a food diary you
// lose on reinstall isn't a diary. The meal *plan* it is displayed against
// stays device-local; see FoodLogEntry for why that asymmetry is fine.
interface FoodLogState {
  entries: FoodLogEntry[];
  addEntry: (entry: Omit<FoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateEntry: (
    id: string,
    patch: Partial<Omit<FoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>>
  ) => void;
  removeEntry: (id: string) => void;
  replaceAll: (entries: FoodLogEntry[]) => void;
}

export const useFoodLogStore = create<FoodLogState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (entry) => {
        const now = Date.now();
        const id = uuid();
        set((s) => ({ entries: [...s.entries, { ...entry, id, createdAt: now, updatedAt: now }] }));
        return id;
      },
      updateEntry: (id, patch) => {
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e
          ),
        }));
      },
      removeEntry: (id) => {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
      },
      replaceAll: (entries) => set({ entries }),
    }),
    {
      name: STORAGE_KEYS.foodLog,
      storage: zustandStorage,
    }
  )
);
