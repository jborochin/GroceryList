# Favorites Tab — Design Spec

**Date:** 2026-07-01
**Status:** Approved

## Context

The Recipes screen (`RecipeLibraryScreen`) currently shows two segments: **My Recipes** (personal saved recipes) and **Browse** (curated meal catalog). Users want a way to mark individual recipes or catalog meals as favorites and access them quickly in a dedicated view.

## Goal

Add a **Favorites** segment to the existing `SegmentedControl` in `RecipeLibraryScreen`. Users tap a heart icon on any recipe card (personal or catalog) to like it; liked items appear in the Favorites tab as a single mixed grid.

---

## Architecture

### New Store — `src/store/useFavoritesStore.ts`

```ts
interface FavoritesState {
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
}
```

- Persisted via `zustandStorage` under `STORAGE_KEYS.favorites` (add the key to `src/store/storage.ts`)
- Wire into `src/store/hydration.ts` `stores` array (required per CLAUDE.md)
- IDs are shared between personal recipes (`useRecipeStore`) and catalog meals (`mealCatalog.json`) — no type distinction needed

### No changes to `Recipe` type

The `Recipe` interface in `src/types/index.ts` stays unchanged.

---

## UI Changes

### 1. `RecipeLibraryScreen.tsx` — Third segment

```ts
type Mode = 'mine' | 'browse' | 'favorites';

items={[
  { value: 'mine',      label: 'My Recipes', icon: 'bookmark-outline' },
  { value: 'browse',    label: 'Browse',     icon: 'earth' },
  { value: 'favorites', label: 'Favorites',  icon: 'heart' },
]}
```

When `mode === 'favorites'`:
- Render a 2-column grid merging:
  1. `useRecipeStore.recipes` filtered by `isFavorite(id)` → `RecipeGridCard`
  2. `mealCatalog` filtered by `isFavorite(id)` → `MealCatalogCard`
  - Personal recipes first, then catalog meals
- Empty state: centered text "No favorites yet — heart a recipe to save it here"
- The floating "Add recipe" FAB does **not** appear in favorites mode

### 2. `RecipeGridCard` — Heart overlay button

- Small heart icon (`heart` / `heart-outline`) in the top-right corner, absolute-positioned
- Filled forest-green `#3A5C42` when favorited; outline when not
- Tapping calls `useFavoritesStore.toggleFavorite(recipe.id)`
- Small semi-transparent touch target so it doesn't conflict with the card tap (which navigates to RecipeDetail)

### 3. `MealCatalogCard` — Same heart overlay button

- Identical treatment to `RecipeGridCard`
- Calls `useFavoritesStore.toggleFavorite(meal.id)`

---

## Data Flow

```
useFavoritesStore.favoriteIds
    ↓ filter
useRecipeStore.recipes  →  favorited personal recipes  →  RecipeGridCard[]
mealCatalog             →  favorited catalog meals     →  MealCatalogCard[]
    ↓ merge
Favorites grid (FlatList, numColumns=2)
```

---

## Out of Scope

- Sort by date favorited
- Heart button inside `RecipeDetailScreen`
- Sync favorites to Supabase

---

## Verification

1. Run `npx expo start`, open Recipes tab
2. Confirm three segments: My Recipes / Browse / Favorites
3. Tap heart on a My Recipes card → fills; open Favorites → card appears
4. Tap heart on a Browse card → fills; open Favorites → card appears
5. Tap heart again → empties; item disappears from Favorites
6. Open Favorites with nothing favorited → empty state message shows
7. Restart app → favorites persist (AsyncStorage)
8. Run `npm run typecheck` — no errors
