import { FoodItem, FoodLogEntry, NutritionPerServing } from '../types';

// Recents and frequents, derived entirely from the user's own log — no new data
// source, no network. In practice this is the list people log from most of the
// time: the same breakfast, the same coffee, the same protein bar.

export interface RecentFood {
  key: string;
  displayName: string;
  brand?: string;
  source: FoodLogEntry['source'];
  sourceId?: string;
  servingQty: number;
  servingLabel: string;
  gramsPerServing?: number;
  /** The macros of the most recent logging, so re-logging reproduces it exactly. */
  nutrition: NutritionPerServing;
  count: number;
  lastLoggedAt: number;
}

/**
 * Identity of a food across loggings. Falls back to the display name when there
 * is no sourceId — two hand-typed "Coffee" entries should still collapse into
 * one recent, and a 'quick' entry has no id at all.
 */
export function recentKey(entry: Pick<FoodLogEntry, 'source' | 'sourceId' | 'displayName'>): string {
  const id = entry.sourceId?.trim();
  return id ? `${entry.source}:${id}` : `${entry.source}:name:${entry.displayName.toLowerCase()}`;
}

/**
 * Collapse log entries into a ranked recents list.
 *
 * Ordered by recency, because "what did I eat this morning" is a far more common
 * question than "what do I eat most". `count` rides along so a caller can
 * re-sort into a frequents list without re-walking the log.
 *
 * Entries confirmed from the meal plan (`fromCellId`) are excluded: they are
 * recipes, which the plan and the recipe library already surface, and they would
 * crowd out the packaged foods this list exists to shortcut.
 */
export function recentFoods(entries: FoodLogEntry[], limit = 50): RecentFood[] {
  const byKey = new Map<string, RecentFood>();

  for (const entry of entries) {
    if (entry.fromCellId) continue;
    const key = recentKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        displayName: entry.displayName,
        brand: entry.brand,
        source: entry.source,
        sourceId: entry.sourceId,
        servingQty: entry.servingQty,
        servingLabel: entry.servingLabel,
        gramsPerServing: entry.gramsPerServing,
        nutrition: entry.nutrition,
        count: 1,
        lastLoggedAt: entry.createdAt,
      });
      continue;
    }
    existing.count += 1;
    // Keep the most recent serving choice — that's the one worth repeating.
    if (entry.createdAt >= existing.lastLoggedAt) {
      existing.lastLoggedAt = entry.createdAt;
      existing.displayName = entry.displayName;
      existing.brand = entry.brand;
      existing.servingQty = entry.servingQty;
      existing.servingLabel = entry.servingLabel;
      existing.gramsPerServing = entry.gramsPerServing;
      existing.nutrition = entry.nutrition;
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.lastLoggedAt - a.lastLoggedAt)
    .slice(0, limit);
}

/** The same set, ranked by how often it's been logged. Ties break on recency. */
export function frequentFoods(entries: FoodLogEntry[], limit = 50): RecentFood[] {
  return recentFoods(entries, Number.POSITIVE_INFINITY)
    .sort((a, b) => b.count - a.count || b.lastLoggedAt - a.lastLoggedAt)
    .slice(0, limit);
}

/**
 * Re-logging a recent reuses its stored macro snapshot rather than re-querying
 * the database — same numbers, offline, instantly.
 *
 * Two bases, because a logged entry may or may not have had a weight behind it:
 *  - With a gram weight, back-compute per-100g so the picker can offer any
 *    portion (half a container, 150 g).
 *  - Without one, divide down to a single serving. A homemade dish logged as
 *    "1 bowl, 400 kcal" has no mass to convert, and dropping it here is what
 *    made re-logging such a food produce a silent 0 kcal.
 */
export function recentToFoodItem(recent: RecentFood): FoodItem {
  const grams = recent.gramsPerServing;
  const qty = recent.servingQty > 0 ? recent.servingQty : 1;
  const weighed = grams && grams > 0 ? grams * qty : 0;

  const per100g =
    weighed > 0
      ? {
          calories: (recent.nutrition.calories / weighed) * 100,
          proteinG: (recent.nutrition.proteinG / weighed) * 100,
          carbsG: (recent.nutrition.carbsG / weighed) * 100,
          fatG: (recent.nutrition.fatG / weighed) * 100,
        }
      : undefined;

  const perServing = per100g
    ? undefined
    : {
        calories: recent.nutrition.calories / qty,
        proteinG: recent.nutrition.proteinG / qty,
        carbsG: recent.nutrition.carbsG / qty,
        fatG: recent.nutrition.fatG / qty,
      };

  return {
    source: recent.source,
    sourceId: recent.sourceId ?? recent.key,
    name: recent.displayName,
    brand: recent.brand,
    per100g,
    perServing,
    servings: [{ label: recent.servingLabel, grams: grams && grams > 0 ? grams : 0 }],
  };
}
