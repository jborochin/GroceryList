import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { deterministicRecipeId, isUuid } from '../utils/deterministicId';

/**
 * One-time repair for installs whose seed recipes carry legacy slug ids
 * (e.g. "seed-sheet-pan-chicken"). Supabase's recipes.id is a uuid column, so
 * those rows can never sync — every push fails and rots in the outbox. Rewrite
 * any non-uuid recipe id to its UUIDv5 (matching what fresh seeds now use) and
 * fix meal-plan entries that point at it.
 *
 * Runs on every launch after hydration; a no-op when all ids are already uuids.
 * Must run BEFORE subscribeStores so the rewrites don't push spurious deletes.
 */
export function remapLegacyRecipeIds(): void {
  const recipeStore = useRecipeStore.getState();
  const legacy = recipeStore.recipes.filter((r) => !isUuid(r.id));
  if (legacy.length === 0) return;

  const idMap = new Map(legacy.map((r) => [r.id, deterministicRecipeId(r.id)]));

  useRecipeStore.setState((s) => ({
    recipes: s.recipes.map((r) => {
      const next = idMap.get(r.id);
      return next ? { ...r, id: next } : r;
    }),
  }));

  useMealPlanStore.setState((s) => ({
    entries: s.entries.map((e) => {
      const next = idMap.get(e.recipeId);
      return next ? { ...e, recipeId: next } : e;
    }),
  }));
}
