import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, supabaseConfigured } from './supabase';
import { STORAGE_KEYS } from '../store/storage';
import { MEAL_CATALOG } from '../data/mealCatalog';
import { Meal } from '../types';

// The global `meals` table is public-read and NOT part of the per-user sync
// (pullAll/subscribeStores). It mirrors the bundled mealCatalog.json so the
// catalog can be updated server-side without an app release. The bundled JSON
// is always the offline floor — a missing/empty cache falls back to it.

let cache: Meal[] | null = null;

function rowToMeal(row: Record<string, unknown>): Meal {
  return {
    id: String(row.id),
    title: String(row.title),
    cuisine: String(row.cuisine),
    slots: (row.slots as Meal['slots']) ?? [],
    dietaryTags: (row.dietary_tags as string[]) ?? [],
    servings: Number(row.servings ?? 1),
    ingredients: (row.ingredients as Meal['ingredients']) ?? [],
    nutritionPerServing: row.nutrition_per_serving as Meal['nutritionPerServing'],
    prepTimeMinutes:
      row.prep_time_minutes == null ? undefined : Number(row.prep_time_minutes),
    imageUrl: (row.image_url as string | null) ?? undefined,
    instructions: (row.instructions as string[] | null) ?? undefined,
  };
}

// Synchronous catalog accessor for the planner. Returns the in-memory cache if
// a refresh has populated it this session, otherwise the bundled catalog.
export function getMealCatalog(): Meal[] {
  return cache ?? MEAL_CATALOG;
}

// Loads any persisted cache from a previous session into memory. Call once on
// app start (or screen mount) so offline launches see the last-known catalog.
export async function loadMealCatalogCache(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.mealCatalogCache);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Meal[];
    if (Array.isArray(parsed) && parsed.length > 0) cache = parsed;
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
