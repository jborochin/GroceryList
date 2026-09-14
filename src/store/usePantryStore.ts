import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { PantryItem } from '../types';
import { STORAGE_KEYS, isRecord, sanitizeList, zustandStorage } from './storage';

interface PantryState {
  items: PantryItem[];
  addItem: (item: Omit<PantryItem, 'id'>) => void;
  updateItem: (id: string, patch: Partial<Omit<PantryItem, 'id'>>) => void;
  removeItem: (id: string) => void;
  replaceAll: (items: PantryItem[]) => void;
}

export const usePantryStore = create<PantryState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) => {
        set((s) => ({ items: [...s.items, { ...item, id: uuid() }] }));
      },
      updateItem: (id, patch) => {
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
      },
      removeItem: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },
      replaceAll: (items) => set({ items }),
    }),
    {
      name: STORAGE_KEYS.pantry,
      storage: zustandStorage,
      merge: (persisted, current) => ({
        ...current,
        items: sanitizeList(
          (persisted as { items?: unknown } | undefined)?.items,
          (x): x is PantryItem => isRecord(x) && typeof x.id === 'string'
        ),
      }),
    }
  )
);
