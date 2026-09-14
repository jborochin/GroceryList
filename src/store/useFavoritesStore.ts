import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS, zustandStorage } from './storage';

interface FavoritesState {
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],
      toggleFavorite: (id) =>
        set((s) => ({
          favoriteIds: s.favoriteIds.includes(id)
            ? s.favoriteIds.filter((fid) => fid !== id)
            : [...s.favoriteIds, id],
        })),
      removeFavorite: (id) =>
        set((s) => ({ favoriteIds: s.favoriteIds.filter((fid) => fid !== id) })),
      isFavorite: (id) => get().favoriteIds.includes(id),
    }),
    {
      name: STORAGE_KEYS.favorites,
      storage: zustandStorage,
    }
  )
);
