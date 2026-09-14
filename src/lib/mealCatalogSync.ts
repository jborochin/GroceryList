import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, supabaseConfigured } from './supabase';
import { STORAGE_KEYS, isRecord } from '../store/storage';
import { MEAL_CATALOG } from '../data/mealCatalog';
import { Meal } from '../types';
import { positiveOr, toNutrition } from '../utils/numbers';
import { sanitizeHttpUrl } from '../utils/safeUrl';

// The global `meals` table is public-read and NOT part of the per-user sync
// (pullAll/subscribeStores). It mirrors the bundled mealCatalog.json so the
// catalog can be updated server-side without an app release. The bundled JSON
// is always the offline floor — a missing/empty cache falls back to it.

let cache: Meal[] | null = null;

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Coerce a server row into a Meal the planner can score without crashing.
 *
 * Every numeric field is finite-checked, `nutritionPerServing` is always a full
 * record (mealPlanner reads `n.calories` unguarded), and `image_url` goes through
 * the same http(s) filter the import paths use before it reaches an <Image>.
 * Same discipline as priceCatalogSync.ingestRows: a bad server row degrades, it
 * never throws into a render.
 */
export function rowToMeal(row: Record<string, unknown>): Meal {
  return {
    id: String(row.id),
    title: String(row.title),
    cuisine: String(row.cuisine),
    slots: stringArray(row.slots) as Meal['slots'],
    dietaryTags: stringArray(row.dietary_tags),
    servings: positiveOr(row.servings, 1),
    ingredients: Array.isArray(row.ingredients)
      ? (row.ingredients.filter(isRecord) as unknown as Meal['ingredients'])
      : [],
    nutritionPerServing: toNutrition(row.nutrition_per_serving),
    prepTimeMinutes:
      row.prep_time_minutes == null ? undefined : positiveOr(row.prep_time_minutes, 0) || undefined,
    imageUrl: sanitizeHttpUrl(row.image_url),
    instructions: row.instructions == null ? undefined : stringArray(row.instructions),
  };
}

// Synchronous catalog accessor for the planner. Returns the in-memory cache if
// a refresh has populated it this session, otherwise the bundled catalog.
export function getMealCatalog(): Meal[] {
  return cache ?? MEAL_CATALOG;
}

// Loads any persisted cache from a previous session into memory. Call once on
// app start (or screen mount) so offline launches see the last-known catalog.
// Rows are re-coerced on the way in: the cache is a copy of server rows, and a
// stricter rowToMeal must apply to what an older build already saved.
export async function loadMealCatalogCache(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.mealCatalogCache);
    if (!stored) return;
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    cache = parsed.filter(isRecord).map((m) => ({
      ...(m as unknown as Meal),
      servings: positiveOr(m.servings, 1),
      nutritionPerServing: toNutrition(m.nutritionPerServing),
      imageUrl: sanitizeHttpUrl(m.imageUrl),
      ingredients: Array.isArray(m.ingredients) ? (m.ingredients as Meal['ingredients']) : [],
    }));
  } catch {
    // Corrupt cache — ignore, bundled catalog stands in.
  }
}

// Fire-and-forget refresh from the server mirror. Never throws and never blocks
// planning; failure silently leaves the bundled/cached catalog in place.
export async function refreshMealCatalogCache(): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('meals').select('*');
    if (error || !data || data.length === 0) return;
    const meals = data.map((r) => rowToMeal(r as Record<string, unknown>));
    cache = meals;
    await AsyncStorage.setItem(STORAGE_KEYS.mealCatalogCache, JSON.stringify(meals));
  } catch {
    // Network/parse error — keep existing catalog.
  }
}
