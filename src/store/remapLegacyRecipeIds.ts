import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { useMealScheduleStore } from './useMealScheduleStore';
import { useGroceryRecipeStore } from './useGroceryRecipeStore';
import { useFavoritesStore } from './useFavoritesStore';
import { useCookSessionStore } from './useCookSessionStore';
import { deterministicRecipeId, isUuid } from '../utils/deterministicId';

/**
 * One-time repair for installs whose seed recipes carry legacy slug ids
 * (e.g. "seed-sheet-pan-chicken"). Supabase's recipes.id is a uuid column, so
 * those rows can never sync — every push fails and rots in the outbox. Rewrite
 * any non-uuid recipe id to its UUIDv5 (matching what fresh seeds now use)
 * EVERYWHERE a recipe id is stored: the plan, the calendar cells, grocery-only
 * adds, favorites and cook sessions. Missing any one of them leaves a reference
 * that no longer resolves ("Planned meal" forever on the Week grid).
 *
 * Runs from useHydration() BEFORE the planning week is re-pointed: that
 * reconcile re-creates plan entries from cell ids, so it must see the new ids or
 * it recreates the unsyncable slug entry on every launch. Also runs before
 * subscribeStores, so the rewrites don't push spurious deletes.
 */
export function remapLegacyRecipeIds(): void {
  const legacy = useRecipeStore.getState().recipes.filter((r) => !isUuid(r.id));
  if (legacy.length === 0) return;

  const idMap = new Map(legacy.map((r) => [r.id, deterministicRecipeId(r.id)]));
  const remap = (id: string) => idMap.get(id) ?? id;

  useRecipeStore.setState((s) => ({
    recipes: s.recipes.map((r) => (idMap.has(r.id) ? { ...r, id: remap(r.id) } : r)),
  }));

  useMealPlanStore.setState((s) => ({
    entries: s.entries.map((e) => (idMap.has(e.recipeId) ? { ...e, recipeId: remap(e.recipeId) } : e)),
  }));

  useMealScheduleStore.setState((s) => ({
    cells: s.cells.map((c) => (idMap.has(c.recipeId) ? { ...c, recipeId: remap(c.recipeId) } : c)),
  }));

  useGroceryRecipeStore.setState((s) => ({
    entries: s.entries.map((e) => (idMap.has(e.recipeId) ? { ...e, recipeId: remap(e.recipeId) } : e)),
  }));

  useFavoritesStore.setState((s) => ({ favoriteIds: s.favoriteIds.map(remap) }));

  useCookSessionStore.setState((s) => {
    const sessions: typeof s.sessions = {};
    for (const [key, session] of Object.entries(s.sessions)) {
      const id = remap(key);
      sessions[id] = idMap.has(key) ? { ...session, recipeId: id } : session;
    }
    return { sessions };
  });
}
