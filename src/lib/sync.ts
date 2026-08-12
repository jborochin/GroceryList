import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostgrestError } from '@supabase/supabase-js';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useCustomFoodStore } from '../store/useCustomFoodStore';
import { STORAGE_KEYS } from '../store/storage';
import {
  CookingFrequency,
  CustomFood,
  FoodLogEntry,
  FoodSource,
  MealPlanEntry,
  MealSlot,
  NutritionPerServing,
  PantryItem,
  PriceOverride,
  Recipe,
  TdeeInputs,
  UserSettings,
} from '../types';
import { getSupabase, supabaseConfigured } from './supabase';
import { enqueue, naturalKey, peekAll, removeMany, OutboxEntry, OutboxTable } from './syncQueue';
import { useSyncStateStore } from '../store/useSyncStateStore';
import { useAuthStore } from '../store/useAuthStore';
import { mergeKeyed, diffKeys } from '../utils/syncMerge';

// Suppress push subscriptions while applying remote data to local stores.
// A counter (not a boolean) so overlapping appliers can't clear each other's
// suppression early.
let applyingRemoteCount = 0;
let unsubscribers: Array<() => void> = [];
let drainInFlight = false;
// Single-flight pulls per user: concurrent callers (sign-in effect + app
// foreground) share one in-flight pull instead of racing each other.
const pullsInFlight = new Map<string, Promise<void>>();

// ---------- Row mappers ----------

function recipeToRow(r: Recipe, userId: string) {
  return {
    id: r.id,
    user_id: userId,
    title: r.title,
    source_url: r.sourceUrl ?? null,
    servings: r.servings,
    ingredients: r.ingredients,
    instructions: r.instructions ?? null,
    nutrition_per_serving: r.nutritionPerServing ?? null,
    image_url: r.imageUrl ?? null,
    created_at: new Date(r.createdAt).toISOString(),
    updated_at: new Date(r.updatedAt).toISOString(),
    deleted_at: null,
  };
}

function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    title: row.title as string,
    sourceUrl: (row.source_url as string | null) ?? undefined,
    servings: Number(row.servings),
    ingredients: (row.ingredients as Recipe['ingredients']) ?? [],
    instructions: (row.instructions as string[] | null) ?? undefined,
    nutritionPerServing: (row.nutrition_per_serving as Recipe['nutritionPerServing']) ?? undefined,
    imageUrl: (row.image_url as string | null) ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
  };
}

function mealEntryToRow(e: MealPlanEntry, userId: string) {
  return {
    user_id: userId,
    recipe_id: e.recipeId,
    desired_servings: e.desiredServings,
    deleted_at: null,
  };
}

function rowToMealEntry(row: Record<string, unknown>): MealPlanEntry {
  return {
    recipeId: row.recipe_id as string,
    desiredServings: Number(row.desired_servings),
  };
}

function pantryToRow(p: PantryItem, userId: string) {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    quantity: p.quantity ?? null,
    unit: p.unit ?? null,
    deleted_at: null,
  };
}

function rowToPantry(row: Record<string, unknown>): PantryItem {
  return {
    id: row.id as string,
    name: row.name as string,
    quantity: row.quantity == null ? undefined : Number(row.quantity),
    unit: (row.unit as string | null) ?? undefined,
  };
}

function overrideToRow(o: PriceOverride, key: string, userId: string) {
  return {
    user_id: userId,
    normalized_name: key,
    display_name: o.name,
    price_per_unit: o.pricePerUnit,
    unit: o.unit,
    deleted_at: null,
  };
}

function foodLogToRow(e: FoodLogEntry, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    entry_date: e.date,
    slot: e.slot,
    display_name: e.displayName,
    brand: e.brand ?? null,
    source: e.source,
    source_id: e.sourceId ?? null,
    barcode: e.barcode ?? null,
    serving_qty: e.servingQty,
    serving_label: e.servingLabel,
    grams_per_serving: e.gramsPerServing ?? null,
    nutrition: e.nutrition,
    from_cell_id: e.fromCellId ?? null,
    replaces_cell_id: e.replacesCellId ?? null,
    created_at: new Date(e.createdAt).toISOString(),
    updated_at: new Date(e.updatedAt).toISOString(),
    deleted_at: null,
  };
}

const ZERO_NUTRITION: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function asSlot(v: unknown): MealSlot {
  return v === 'breakfast' || v === 'lunch' || v === 'dinner' || v === 'snack' ? v : 'snack';
}

function asFoodSource(v: unknown): FoodSource {
  return v === 'usda' || v === 'off' || v === 'custom' || v === 'recipe' || v === 'quick'
    ? v
    : 'quick';
}

function asNutrition(v: unknown): NutritionPerServing {
  const n = (v ?? {}) as Partial<NutritionPerServing>;
  return {
    calories: Number(n.calories) || 0,
    proteinG: Number(n.proteinG) || 0,
    carbsG: Number(n.carbsG) || 0,
    fatG: Number(n.fatG) || 0,
  };
}

function rowToFoodLog(row: Record<string, unknown>): FoodLogEntry {
  return {
    id: row.id as string,
    // `entry_date` is a Postgres `date`, which PostgREST renders as YYYY-MM-DD —
    // already the local date key the day view uses. Never build a Date from it:
    // that would reinterpret it as UTC midnight and shift the day west of GMT.
    date: String(row.entry_date).slice(0, 10),
    slot: asSlot(row.slot),
    displayName: row.display_name as string,
    brand: (row.brand as string | null) ?? undefined,
    source: asFoodSource(row.source),
    sourceId: (row.source_id as string | null) ?? undefined,
    barcode: (row.barcode as string | null) ?? undefined,
    servingQty: Number(row.serving_qty),
    servingLabel: (row.serving_label as string | null) ?? 'g',
    gramsPerServing: row.grams_per_serving == null ? undefined : Number(row.grams_per_serving),
    nutrition: asNutrition(row.nutrition) ?? ZERO_NUTRITION,
    fromCellId: (row.from_cell_id as string | null) ?? undefined,
    replacesCellId: (row.replaces_cell_id as string | null) ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
  };
}

function customFoodToRow(f: CustomFood, userId: string) {
  return {
    id: f.id,
    user_id: userId,
    name: f.name,
    brand: f.brand ?? null,
    serving_label: f.servingLabel,
    grams_per_serving: f.gramsPerServing ?? null,
    nutrition_per_serving: f.nutritionPerServing,
    barcode: f.barcode ?? null,
    created_at: new Date(f.createdAt).toISOString(),
    updated_at: new Date(f.updatedAt).toISOString(),
    deleted_at: null,
  };
}

function rowToCustomFood(row: Record<string, unknown>): CustomFood {
  return {
    id: row.id as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? undefined,
    servingLabel: (row.serving_label as string | null) ?? 'serving',
    gramsPerServing: row.grams_per_serving == null ? undefined : Number(row.grams_per_serving),
    nutritionPerServing: asNutrition(row.nutrition_per_serving),
    barcode: (row.barcode as string | null) ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
  };
}

function settingsToRow(s: UserSettings, userId: string) {
  return {
    user_id: userId,
    daily_calorie_target: s.dailyCalorieTarget,
    protein_pct: s.macroSplit.proteinPct,
    carbs_pct: s.macroSplit.carbsPct,
    fat_pct: s.macroSplit.fatPct,
    protein_g: s.macroGrams.proteinG,
    carbs_g: s.macroGrams.carbsG,
    fat_g: s.macroGrams.fatG,
    reduce_visual_effects: s.reduceVisualEffects,
    onboarding_completed: s.onboardingCompleted,
    cuisine_preferences: s.cuisinePreferences,
    dietary_restrictions: s.dietaryRestrictions,
    cooking_frequency: s.cookingFrequency,
    cooking_ease_preference: s.cookingEasePreference,
    tdee_inputs: s.tdeeInputs,
  };
}

function asCookingFrequency(v: unknown): CookingFrequency {
  return v === 'batch' || v === 'few_days' || v === 'daily' ? v : 'few_days';
}

function asEasePreference(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function rowToSettings(row: Record<string, unknown>): UserSettings {
  return {
    dailyCalorieTarget: Number(row.daily_calorie_target),
    macroSplit: {
      proteinPct: Number(row.protein_pct),
      carbsPct: Number(row.carbs_pct),
      fatPct: Number(row.fat_pct),
    },
    macroGrams: {
      proteinG: Number(row.protein_g),
      carbsG: Number(row.carbs_g),
      fatG: Number(row.fat_g),
    },
    reduceVisualEffects: Boolean(row.reduce_visual_effects),
    onboardingCompleted: Boolean(row.onboarding_completed),
    cuisinePreferences: asStringArray(row.cuisine_preferences),
    dietaryRestrictions: asStringArray(row.dietary_restrictions),
    cookingFrequency: asCookingFrequency(row.cooking_frequency),
    cookingEasePreference: asEasePreference(row.cooking_ease_preference),
    tdeeInputs: (row.tdee_inputs as TdeeInputs | null) ?? null,
  };
}

// ---------- Push helpers ----------

async function safePush(
  table: OutboxEntry['table'],
  op: OutboxEntry['op'],
  payload: Record<string, unknown>,
  exec: () => PromiseLike<{ error: PostgrestError | null }>
) {
  if (!supabaseConfigured) return;
  try {
    const { error } = await exec();
    if (error) await enqueue({ table, op, payload });
  } catch {
    await enqueue({ table, op, payload });
  }
}

async function pushRecipe(r: Recipe, userId: string) {
  const row = recipeToRow(r, userId);
  await safePush('recipes', 'upsert', row, () => getSupabase().from('recipes').upsert(row));
}

async function pushRecipeDelete(id: string, userId: string) {
  const payload = { id, user_id: userId };
  await safePush('recipes', 'delete', payload, () =>
    getSupabase()
      .from('recipes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
  );
}

async function pushMealEntry(e: MealPlanEntry, userId: string) {
  const row = mealEntryToRow(e, userId);
  await safePush('meal_plan_entries', 'upsert', row, () =>
    getSupabase().from('meal_plan_entries').upsert(row, { onConflict: 'user_id,recipe_id' })
  );
}

async function pushMealEntryDelete(recipeId: string, userId: string) {
  const payload = { recipe_id: recipeId, user_id: userId };
  await safePush('meal_plan_entries', 'delete', payload, () =>
    getSupabase()
      .from('meal_plan_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('recipe_id', recipeId)
      .eq('user_id', userId)
  );
}

async function pushPantry(p: PantryItem, userId: string) {
  const row = pantryToRow(p, userId);
  await safePush('pantry_items', 'upsert', row, () => getSupabase().from('pantry_items').upsert(row));
}

async function pushPantryDelete(id: string, userId: string) {
  const payload = { id, user_id: userId };
  await safePush('pantry_items', 'delete', payload, () =>
    getSupabase()
      .from('pantry_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
  );
}

async function pushOverride(key: string, o: PriceOverride, userId: string) {
  const row = overrideToRow(o, key, userId);
  await safePush('price_overrides', 'upsert', row, () =>
    getSupabase().from('price_overrides').upsert(row, { onConflict: 'user_id,normalized_name' })
  );
}

async function pushOverrideDelete(key: string, userId: string) {
  const payload = { normalized_name: key, user_id: userId };
  await safePush('price_overrides', 'delete', payload, () =>
    getSupabase()
      .from('price_overrides')
      .update({ deleted_at: new Date().toISOString() })
      .eq('normalized_name', key)
      .eq('user_id', userId)
  );
}

async function pushFoodLog(e: FoodLogEntry, userId: string) {
  const row = foodLogToRow(e, userId);
  await safePush('food_log_entries', 'upsert', row, () =>
    getSupabase().from('food_log_entries').upsert(row)
  );
}

async function pushFoodLogDelete(id: string, userId: string) {
  const payload = { id, user_id: userId };
  await safePush('food_log_entries', 'delete', payload, () =>
    getSupabase()
      .from('food_log_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
  );
}

async function pushCustomFood(f: CustomFood, userId: string) {
  const row = customFoodToRow(f, userId);
  await safePush('custom_foods', 'upsert', row, () =>
    getSupabase().from('custom_foods').upsert(row)
  );
}

async function pushCustomFoodDelete(id: string, userId: string) {
  const payload = { id, user_id: userId };
  await safePush('custom_foods', 'delete', payload, () =>
    getSupabase()
      .from('custom_foods')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
  );
}

async function pushSettings(s: UserSettings, userId: string) {
  const row = settingsToRow(s, userId);
  await safePush('user_settings', 'upsert', row, () =>
    getSupabase().from('user_settings').upsert(row, { onConflict: 'user_id' })
  );
}

// ---------- Pull ----------

type Row = Record<string, unknown>;

// Splits fetched rows (which include soft-deleted tombstones) and runs the
// pure merge against current local state. See src/utils/syncMerge.ts for the
// precedence rules and why this is deliberately timestamp-free.
function mergeStore<T>(
  rows: Row[],
  rowKey: (row: Row) => string,
  rowToLocal: (row: Row) => T,
  snapshot: Map<string, T>,
  current: Map<string, T>,
  pending: OutboxEntry[],
  table: OutboxTable
): { next: Array<[string, T]>; toPush: Array<[string, T]> } {
  const serverLive = new Map<string, T>();
  const serverDeadKeys = new Set<string>();
  for (const row of rows) {
    if (row.deleted_at != null) serverDeadKeys.add(rowKey(row));
    else serverLive.set(rowKey(row), rowToLocal(row));
  }
  const pendingKeys = (op: OutboxEntry['op']) =>
    new Set(
      pending
        .filter((e) => e.table === table && e.op === op)
        .map((e) => String(naturalKey(e.table, e.payload)))
    );
  return mergeKeyed({
    local: current,
    serverLive,
    serverDeadKeys,
    editedKeys: diffKeys(snapshot, current),
    pendingUpsertKeys: pendingKeys('upsert'),
    pendingDeleteKeys: pendingKeys('delete'),
  });
}

export function pullAll(userId: string): Promise<void> {
  if (!supabaseConfigured) return Promise.resolve();
  const existing = pullsInFlight.get(userId);
  if (existing) return existing;
  const p = doPullAll(userId).finally(() => {
    pullsInFlight.delete(userId);
  });
  pullsInFlight.set(userId, p);
  return p;
}

async function doPullAll(userId: string): Promise<void> {
  const supabase = getSupabase();
  try {
    // Per-key reference snapshots BEFORE the fetch: anything whose reference
    // differs at apply time was touched while the pull was in flight, and the
    // merge keeps the local version (zustand updates are immutable per item).
    const snapRecipes = new Map(useRecipeStore.getState().recipes.map((r) => [r.id, r]));
    const snapMeals = new Map(useMealPlanStore.getState().entries.map((e) => [e.recipeId, e]));
    const snapPantry = new Map(usePantryStore.getState().items.map((i) => [i.id, i]));
    const snapOverrides = new Map(Object.entries(usePriceOverrideStore.getState().overrides));
    const snapFoodLog = new Map(useFoodLogStore.getState().entries.map((e) => [e.id, e]));
    const snapCustomFoods = new Map(useCustomFoodStore.getState().foods.map((f) => [f.id, f]));
    const snapSettings = useSettingsStore.getState().settings;

    // Fetch INCLUDING soft-deleted rows: without tombstones, a remotely
    // deleted item is indistinguishable from a never-pushed local creation,
    // and the merge would push it back to life.
    const [recipes, meals, pantry, overrides, foodLog, customFoods, settings] = await Promise.all([
      supabase.from('recipes').select('*').eq('user_id', userId),
      supabase.from('meal_plan_entries').select('*').eq('user_id', userId),
      supabase.from('pantry_items').select('*').eq('user_id', userId),
      supabase.from('price_overrides').select('*').eq('user_id', userId),
      supabase.from('food_log_entries').select('*').eq('user_id', userId),
      supabase.from('custom_foods').select('*').eq('user_id', userId),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    // The user may have signed out (or switched accounts) during the fetch —
    // never apply one account's rows to another's session.
    if (useAuthStore.getState().user?.id !== userId) return;

    const pending = (await peekAll()).filter((e) => e.payload.user_id === userId);
    const pushQueue: Array<() => void> = [];

    applyingRemoteCount++;
    try {
      if (!recipes.error && recipes.data) {
        const current = new Map(useRecipeStore.getState().recipes.map((r) => [r.id, r]));
        const { next, toPush } = mergeStore(
          recipes.data as Row[],
          (row) => row.id as string,
          rowToRecipe,
          snapRecipes,
          current,
          pending,
          'recipes'
        );
        useRecipeStore.getState().replaceAll(next.map(([, r]) => r));
        for (const [, r] of toPush) pushQueue.push(() => void pushRecipe(r, userId));
      }
      if (!meals.error && meals.data) {
        const current = new Map(useMealPlanStore.getState().entries.map((e) => [e.recipeId, e]));
        const { next, toPush } = mergeStore(
          meals.data as Row[],
          (row) => row.recipe_id as string,
          rowToMealEntry,
          snapMeals,
          current,
          pending,
          'meal_plan_entries'
        );
        useMealPlanStore.setState({ entries: next.map(([, e]) => e) });
        for (const [, e] of toPush) pushQueue.push(() => void pushMealEntry(e, userId));
      }
      if (!pantry.error && pantry.data) {
        const current = new Map(usePantryStore.getState().items.map((i) => [i.id, i]));
        const { next, toPush } = mergeStore(
          pantry.data as Row[],
          (row) => row.id as string,
          rowToPantry,
          snapPantry,
          current,
          pending,
          'pantry_items'
        );
        usePantryStore.getState().replaceAll(next.map(([, i]) => i));
        for (const [, i] of toPush) pushQueue.push(() => void pushPantry(i, userId));
      }
      if (!overrides.error && overrides.data) {
        const current = new Map(Object.entries(usePriceOverrideStore.getState().overrides));
        const { next, toPush } = mergeStore(
          overrides.data as Row[],
          (row) => row.normalized_name as string,
          (row): PriceOverride => ({
            name: (row.display_name as string) ?? (row.normalized_name as string),
            pricePerUnit: Number(row.price_per_unit),
            unit: row.unit as string,
          }),
          snapOverrides,
          current,
          pending,
          'price_overrides'
        );
        usePriceOverrideStore.setState({ overrides: Object.fromEntries(next) });
        for (const [key, o] of toPush) pushQueue.push(() => void pushOverride(key, o, userId));
      }
      if (!foodLog.error && foodLog.data) {
        const current = new Map(useFoodLogStore.getState().entries.map((e) => [e.id, e]));
        const { next, toPush } = mergeStore(
          foodLog.data as Row[],
          (row) => row.id as string,
          rowToFoodLog,
          snapFoodLog,
          current,
          pending,
          'food_log_entries'
        );
        useFoodLogStore.getState().replaceAll(next.map(([, e]) => e));
        for (const [, e] of toPush) pushQueue.push(() => void pushFoodLog(e, userId));
      }
      if (!customFoods.error && customFoods.data) {
        const current = new Map(useCustomFoodStore.getState().foods.map((f) => [f.id, f]));
        const { next, toPush } = mergeStore(
          customFoods.data as Row[],
          (row) => row.id as string,
          rowToCustomFood,
          snapCustomFoods,
          current,
          pending,
          'custom_foods'
        );
        useCustomFoodStore.getState().replaceAll(next.map(([, f]) => f));
        for (const [, f] of toPush) pushQueue.push(() => void pushCustomFood(f, userId));
      }
      if (!settings.error && settings.data) {
        // Settings are a single atomic object: apply the server copy only if
        // the user didn't change anything while the pull was in flight.
        if (useSettingsStore.getState().settings === snapSettings) {
          useSettingsStore.getState().hydrateFromServer(rowToSettings(settings.data));
        }
      }
    } finally {
      applyingRemoteCount--;
    }

    // Push rows the server has never seen (created before sign-in, or rescued
    // from a failed migrate). Pushes go store→server only — no subscriber echo.
    for (const push of pushQueue) push();

    const allOk =
      !recipes.error &&
      !meals.error &&
      !pantry.error &&
      !overrides.error &&
      !foodLog.error &&
      !customFoods.error &&
      !settings.error;
    if (allOk) {
      await AsyncStorage.setItem(STORAGE_KEYS.lastSyncedAt, String(Date.now()));
    }
  } finally {
    // Flip the gate even on a partial/failed pull so the UI never hangs in
    // an indeterminate state waiting for a pull that won't come.
    useSyncStateStore.getState().setFirstPullCompleted(true);
  }
}

// ---------- Outbox drain ----------

export async function drainOutbox(userId: string): Promise<void> {
  if (!supabaseConfigured || drainInFlight) return;
  drainInFlight = true;
  try {
    const all = await peekAll();
    if (all.length === 0) return;
    // Entries queued under a different account can never succeed (RLS rejects
    // them) — drop them instead of replaying user A's edits in user B's session.
    const stale = all.filter((e) => e.payload.user_id !== userId).map((e) => e.id);
    await removeMany(stale);
    const entries = all.filter((e) => e.payload.user_id === userId);
    if (entries.length === 0) return;
    const supabase = getSupabase();
    const succeeded: string[] = [];
    for (const e of entries) {
      try {
        let res: { error: PostgrestError | null };
        if (e.op === 'upsert') {
          const opts =
            e.table === 'meal_plan_entries'
              ? { onConflict: 'user_id,recipe_id' }
              : e.table === 'price_overrides'
              ? { onConflict: 'user_id,normalized_name' }
              : e.table === 'user_settings'
              ? { onConflict: 'user_id' }
              : undefined;
          res = await supabase.from(e.table).upsert(e.payload, opts);
        } else {
          let q = supabase.from(e.table).update({ deleted_at: new Date().toISOString() });
          for (const [k, v] of Object.entries(e.payload)) {
            q = q.eq(k, v as string);
          }
          res = await q;
        }
        if (!res.error) succeeded.push(e.id);
      } catch {
        // leave in queue
      }
    }
    await removeMany(succeeded);
  } finally {
    drainInFlight = false;
  }
}

// ---------- Subscribe ----------

export function subscribeStores(userId: string): () => void {
  unsubscribeStores();

  unsubscribers.push(
    useRecipeStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevMap = new Map(prev.recipes.map((r) => [r.id, r]));
      const nextMap = new Map(state.recipes.map((r) => [r.id, r]));
      for (const r of state.recipes) {
        const p = prevMap.get(r.id);
        if (!p || p.updatedAt !== r.updatedAt) void pushRecipe(r, userId);
      }
      for (const r of prev.recipes) {
        if (!nextMap.has(r.id)) void pushRecipeDelete(r.id, userId);
      }
    })
  );

  unsubscribers.push(
    useMealPlanStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevMap = new Map(prev.entries.map((e) => [e.recipeId, e]));
      const nextMap = new Map(state.entries.map((e) => [e.recipeId, e]));
      for (const e of state.entries) {
        const p = prevMap.get(e.recipeId);
        if (!p || p.desiredServings !== e.desiredServings) void pushMealEntry(e, userId);
      }
      for (const e of prev.entries) {
        if (!nextMap.has(e.recipeId)) void pushMealEntryDelete(e.recipeId, userId);
      }
    })
  );

  unsubscribers.push(
    usePantryStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevMap = new Map(prev.items.map((i) => [i.id, i]));
      const nextMap = new Map(state.items.map((i) => [i.id, i]));
      for (const i of state.items) {
        const p = prevMap.get(i.id);
        if (!p || p.name !== i.name || p.quantity !== i.quantity || p.unit !== i.unit) {
          void pushPantry(i, userId);
        }
      }
      for (const i of prev.items) {
        if (!nextMap.has(i.id)) void pushPantryDelete(i.id, userId);
      }
    })
  );

  unsubscribers.push(
    usePriceOverrideStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevKeys = new Set(Object.keys(prev.overrides));
      const nextKeys = new Set(Object.keys(state.overrides));
      for (const key of nextKeys) {
        const p = prev.overrides[key];
        const n = state.overrides[key];
        if (!p || p.pricePerUnit !== n.pricePerUnit || p.unit !== n.unit) {
          void pushOverride(key, n, userId);
        }
      }
      for (const key of prevKeys) {
        if (!nextKeys.has(key)) void pushOverrideDelete(key, userId);
      }
    })
  );

  unsubscribers.push(
    useFoodLogStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevMap = new Map(prev.entries.map((e) => [e.id, e]));
      const nextMap = new Map(state.entries.map((e) => [e.id, e]));
      for (const e of state.entries) {
        const p = prevMap.get(e.id);
        if (!p || p.updatedAt !== e.updatedAt) void pushFoodLog(e, userId);
      }
      for (const e of prev.entries) {
        if (!nextMap.has(e.id)) void pushFoodLogDelete(e.id, userId);
      }
    })
  );

  unsubscribers.push(
    useCustomFoodStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      const prevMap = new Map(prev.foods.map((f) => [f.id, f]));
      const nextMap = new Map(state.foods.map((f) => [f.id, f]));
      for (const f of state.foods) {
        const p = prevMap.get(f.id);
        if (!p || p.updatedAt !== f.updatedAt) void pushCustomFood(f, userId);
      }
      for (const f of prev.foods) {
        if (!nextMap.has(f.id)) void pushCustomFoodDelete(f.id, userId);
      }
    })
  );

  unsubscribers.push(
    useSettingsStore.subscribe((state, prev) => {
      if (applyingRemoteCount > 0) return;
      if (state.settings === prev.settings) return;
      void pushSettings(state.settings, userId);
    })
  );

  return unsubscribeStores;
}

export function unsubscribeStores(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  // Reset the first-pull gate so a subsequent sign-in re-waits for a fresh pull
  // before deciding whether to show onboarding (avoids stale "done" from prior user).
  useSyncStateStore.getState().setFirstPullCompleted(false);
}

// ---------- First-sign-in migration ----------

/**
 * Push existing local data to a freshly signed-in account, exactly once per (device, account).
 * Run BEFORE pullAll on first sign-in so the account inherits seed data and any user additions.
 */
export async function migrateLocalToAccount(userId: string): Promise<void> {
  if (!supabaseConfigured) return;
  const stamped = await AsyncStorage.getItem(STORAGE_KEYS.migratedAccountId);
  if (stamped === userId) return;

  const recipes = useRecipeStore.getState().recipes;
  const entries = useMealPlanStore.getState().entries;
  const pantry = usePantryStore.getState().items;
  const overrides = usePriceOverrideStore.getState().overrides;
  const foodLog = useFoodLogStore.getState().entries;
  const customFoods = useCustomFoodStore.getState().foods;
  const settings = useSettingsStore.getState().settings;

  const supabase = getSupabase();

  // ignoreDuplicates: a second device signing into an existing account must
  // never overwrite (or resurrect tombstoned) rows the account already has —
  // only contribute rows the server has never seen. The merge-on-pull's
  // local-only push acts as the retry net if any of these batches fail.
  if (recipes.length > 0) {
    await supabase
      .from('recipes')
      .upsert(recipes.map((r) => recipeToRow(r, userId)), { ignoreDuplicates: true });
  }
  if (entries.length > 0) {
    await supabase
      .from('meal_plan_entries')
      .upsert(entries.map((e) => mealEntryToRow(e, userId)), {
        onConflict: 'user_id,recipe_id',
        ignoreDuplicates: true,
      });
  }
  if (pantry.length > 0) {
    await supabase
      .from('pantry_items')
      .upsert(pantry.map((p) => pantryToRow(p, userId)), { ignoreDuplicates: true });
  }
  const overrideRows = Object.entries(overrides).map(([key, o]) => overrideToRow(o, key, userId));
  if (overrideRows.length > 0) {
    await supabase
      .from('price_overrides')
      .upsert(overrideRows, { onConflict: 'user_id,normalized_name', ignoreDuplicates: true });
  }
  if (foodLog.length > 0) {
    await supabase
      .from('food_log_entries')
      .upsert(foodLog.map((e) => foodLogToRow(e, userId)), { ignoreDuplicates: true });
  }
  if (customFoods.length > 0) {
    await supabase
      .from('custom_foods')
      .upsert(customFoods.map((f) => customFoodToRow(f, userId)), { ignoreDuplicates: true });
  }
  // Settings can't use ignoreDuplicates: the handle_new_user trigger creates a
  // default row at signup, so the row always exists. Migrate local settings
  // only while the account is still on untouched defaults (not yet onboarded)
  // — a second device joining an onboarded account must not overwrite it.
  const serverSettings = await supabase
    .from('user_settings')
    .select('onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle();
  const accountOnboarded = Boolean(serverSettings.data?.onboarding_completed);
  if (!serverSettings.error && !accountOnboarded) {
    await supabase
      .from('user_settings')
      .upsert(settingsToRow(settings, userId), { onConflict: 'user_id' });
  }

  await AsyncStorage.setItem(STORAGE_KEYS.migratedAccountId, userId);
}
