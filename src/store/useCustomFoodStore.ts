import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { CustomFood } from '../types';
import { STORAGE_KEYS, zustandStorage } from './storage';

// Foods the user defined by hand. Synced alongside the log — a custom food is
// only useful if the entries referencing it can still be re-logged elsewhere.
interface CustomFoodState {
  foods: CustomFood[];
  addFood: (food: Omit<CustomFood, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFood: (
    id: string,
    patch: Partial<Omit<CustomFood, 'id' | 'createdAt' | 'updatedAt'>>
  ) => void;
  removeFood: (id: string) => void;
  replaceAll: (foods: CustomFood[]) => void;
}

export const useCustomFoodStore = create<CustomFoodState>()(
  persist(
    (set) => ({
      foods: [],
      addFood: (food) => {
        const now = Date.now();
        const id = uuid();
        set((s) => ({ foods: [...s.foods, { ...food, id, createdAt: now, updatedAt: now }] }));
        return id;
      },
      updateFood: (id, patch) => {
        set((s) => ({
          foods: s.foods.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f)),
        }));
      },
      removeFood: (id) => {
        set((s) => ({ foods: s.foods.filter((f) => f.id !== id) }));
      },
      replaceAll: (foods) => set({ foods }),
    }),
    {
      name: STORAGE_KEYS.customFoods,
      storage: zustandStorage,
    }
  )
);
