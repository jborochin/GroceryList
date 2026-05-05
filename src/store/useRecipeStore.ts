import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { Recipe } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface RecipeState {
  recipes: Recipe[];
  addRecipe: (partial: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => Recipe;
  upsertRecipe: (recipe: Recipe) => void;
  updateRecipe: (id: string, patch: Partial<Omit<Recipe, 'id' | 'createdAt'>>) => void;
  deleteRecipe: (id: string) => void;
  getById: (id: string) => Recipe | undefined;
  replaceAll: (recipes: Recipe[]) => void;
}

export const useRecipeStore = create<RecipeState>()(
  persist(
    (set, get) => ({
      recipes: [],
      addRecipe: (partial) => {
        const now = Date.now();
        const recipe: Recipe = { ...partial, id: uuid(), createdAt: now, updatedAt: now };
        set((s) => ({ recipes: [recipe, ...s.recipes] }));
        return recipe;
      },
      upsertRecipe: (recipe) => {
        set((s) => {
          const idx = s.recipes.findIndex((r) => r.id === recipe.id);
          if (idx >= 0) {
            const copy = [...s.recipes];
            copy[idx] = { ...recipe, updatedAt: Date.now() };
            return { recipes: copy };
          }
          return { recipes: [recipe, ...s.recipes] };
        });
      },
      updateRecipe: (id, patch) => {
        set((s) => ({
          recipes: s.recipes.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
        }));
      },
      deleteRecipe: (id) => {
        set((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) }));
      },
      getById: (id) => get().recipes.find((r) => r.id === id),
      replaceAll: (recipes) => set({ recipes }),
    }),
    {
      name: STORAGE_KEYS.recipes,
      storage: zustandStorage,
    }
  )
);
