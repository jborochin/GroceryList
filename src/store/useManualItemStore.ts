import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { ManualItem } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface ManualItemState {
  items: ManualItem[];
  addItem: (item: Omit<ManualItem, 'id'>) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

export const useManualItemStore = create<ManualItemState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) => {
        set((s) => ({ items: [...s.items, { ...item, id: uuid() }] }));
      },
      removeItem: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },
      clearAll: () => set({ items: [] }),
    }),
    {
      name: STORAGE_KEYS.manualItems,
      storage: zustandStorage,
    }
  )
);
