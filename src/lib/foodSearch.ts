import { FoodItem } from '../types';
import { ingestFoodItems } from '../utils/foodSearchMapping';
import { getSupabase, supabaseConfigured } from './supabase';

// Client for the food-search edge function. The function owns the API keys and
// the response cache; this side owns a small in-memory cache so retyping a
// search term or re-scanning the same barcode costs nothing.
//
// Deliberately NOT persisted. The server cache already survives across users and
// installs, and an offline device has no way to search a database it doesn't
// carry — recents, custom foods and the meal plan are the offline paths.

export type FoodSearchErrorKind =
  | 'network'
  | 'not-configured'
  | 'not-found'
  | 'bad-request';

export class FoodSearchError extends Error {
  readonly kind: FoodSearchErrorKind;
  constructor(kind: FoodSearchErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const cache = new Map<string, FoodItem[]>();
const MAX_CACHE_ENTRIES = 100;

function remember(key: string, foods: FoodItem[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Oldest insertion first — Map preserves it. Cheaper than an LRU and the
    // difference is unmeasurable at 100 entries.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, foods);
}

interface FunctionResponse {
  ok?: boolean;
  kind?: string;
  message?: string;
  foods?: unknown;
}

async function callFunction(body: Record<string, unknown>): Promise<FoodItem[]> {
  if (!supabaseConfigured) {
    throw new FoodSearchError('not-configured', 'Food search needs Supabase to be configured.');
  }

  let data: FunctionResponse;
  try {
    const res = await getSupabase().functions.invoke('food-search', { body });
    if (res.error) throw res.error;
    data = (res.data ?? {}) as FunctionResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Food search failed.';
    throw new FoodSearchError('network', message);
  }

  if (!data.ok) {
    const kind: FoodSearchErrorKind =
      data.kind === 'not-configured'
        ? 'not-configured'
        : data.kind === 'bad-request'
        ? 'bad-request'
        : 'network';
    throw new FoodSearchError(kind, data.message ?? 'Food search failed.');
  }

  // Validate before anything reaches the UI: the function is ours, but the
  // databases behind it are not, and a NaN would land in a stored diary entry.
  return ingestFoodItems(data.foods);
}

/** Search the food database by name. Returns [] for a genuine no-results. */
export async function searchFoods(query: string): Promise<FoodItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const key = `q:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const foods = await callFunction({ query: q });
  remember(key, foods);
  return foods;
}

/**
 * Resolve a scanned barcode.
 *
 * Throws `not-found` rather than returning null so the scan screen can route
 * straight to "add it as a custom food" — a miss is a routine outcome worth
 * acting on, not an error to swallow.
 */
export async function lookupBarcode(barcode: string): Promise<FoodItem> {
  const code = barcode.trim();
  const key = `upc:${code}`;
  const hit = cache.get(key);
  if (hit?.[0]) return hit[0];

  const foods = await callFunction({ barcode: code });
  if (foods.length === 0) {
    throw new FoodSearchError('not-found', `No food found for barcode ${code}.`);
  }
  remember(key, foods);
  return foods[0];
}

/**
 * Load an FDC food's household portions ("1 medium banana", "1 cup, sliced").
 *
 * Search responses carry portions for branded products but never for
 * Foundation/SR Legacy rows — `foodMeasures` comes back empty for every dataset
 * (verified live; see the food-search function). Fetching detail for all 25
 * results would cost 25 upstream calls per keystroke-batch, so the serving
 * picker asks for the one food the user actually chose.
 *
 * Total, not throwing: a whole food with no portions is still perfectly
 * loggable in grams, so a failure here must never block logging.
 */
export async function loadFoodPortions(item: FoodItem): Promise<FoodItem> {
  if (item.source !== 'usda' || item.servings.length > 0) return item;
  if (!/^\d+$/.test(item.sourceId)) return item;

  const key = `fdc:${item.sourceId}`;
  const hit = cache.get(key);
  if (hit?.[0]) return hit[0];

  try {
    const foods = await callFunction({ fdcId: item.sourceId });
    const detailed = foods[0];
    if (!detailed || detailed.servings.length === 0) return item;
    // Keep the search result's own name and brand — the detail response
    // describes the same food, and swapping the label under the user mid-flow
    // would be disorienting.
    const merged: FoodItem = { ...item, servings: detailed.servings };
    remember(key, [merged]);
    return merged;
  } catch {
    return item;
  }
}

/** Test seam — the module cache is process-global. */
export function clearFoodSearchCache(): void {
  cache.clear();
}
