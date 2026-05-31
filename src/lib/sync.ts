import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostgrestError } from '@supabase/supabase-js';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { STORAGE_KEYS } from '../store/storage';
import {
  MealPlanEntry,
  PantryItem,
  PriceOverride,
  Recipe,
  TdeeInputs,
  UserSettings,
} from '../types';
import { getSupabase, supabaseConfigured } from './supabase';
import { enqueue, peekAll, removeMany, OutboxEntry } from './syncQueue';
import { useSyncStateStore } from '../store/useSyncStateStore';

// Suppress push subscriptions while applying remote data to local stores.
let isApplyingRemote = false;
let unsubscribers: Array<() => void> = [];
let drainInFlight = false;

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
    tdee_inputs: s.tdeeInputs,
  };
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

async function pushSettings(s: UserSettings, userId: string) {
  const row = settingsToRow(s, userId);
  await safePush('user_settings', 'upsert', row, () =>
    getSupabase().from('user_settings').upsert(row, { onConflict: 'user_id' })
  );
}

// ---------- Pull ----------

export async function pullAll(userId: string): Promise<void> {
  if (!supabaseConfigured) return;
  const supabase = getSupabase();
  isApplyingRemote = true;
  try {
    const [recipes, meals, pantry, overrides, settings] = await Promise.all([
      supabase.from('recipes').select('*').eq('user_id', userId).is('deleted_at', null),
      supabase.from('meal_plan_entries').select('*').eq('user_id', userId).is('deleted_at', null),
      supabase.from('pantry_items').select('*').eq('user_id', userId).is('deleted_at', null),
      supabase.from('price_overrides').select('*').eq('user_id', userId).is('deleted_at', null),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    if (!recipes.error && recipes.data) {
      useRecipeStore.getState().replaceAll(recipes.data.map(rowToRecipe));
    }
    if (!meals.error && meals.data) {
      useMealPlanStore.setState({ entries: meals.data.map(rowToMealEntry) });
    }
    if (!pantry.error && pantry.data) {
      usePantryStore.getState().replaceAll(pantry.data.map(rowToPantry));
    }
    if (!overrides.error && overrides.data) {
      const next: Record<string, PriceOverride> = {};
      for (const row of overrides.data as Array<Record<string, unknown>>) {
        const key = row.normalized_name as string;
        next[key] = {
          name: (row.display_name as string) ?? key,
          pricePerUnit: Number(row.price_per_unit),
          unit: row.unit as string,
        };
      }
      usePriceOverrideStore.setState({ overrides: next });
    }
    if (!settings.error && settings.data) {
      useSettingsStore.getState().hydrateFromServer(rowToSettings(settings.data));
    }

    await AsyncStorage.setItem(STORAGE_KEYS.lastSyncedAt, String(Date.now()));
  } finally {
    isApplyingRemote = false;
    // Flip the gate even on a partial/failed pull so the UI never hangs in
    // an indeterminate state waiting for a pull that won't come.
    useSyncStateStore.getState().setFirstPullCompleted(true);
  }
}

// ---------- Outbox drain ----------

export async function drainOutbox(): Promise<void> {
  if (!supabaseConfigured || drainInFlight) return;
  drainInFlight = true;
  try {
    const entries = await peekAll();
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
      if (isApplyingRemote) return;
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
      if (isApplyingRemote) return;
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
      if (isApplyingRemote) return;
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
      if (isApplyingRemote) return;
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
    useSettingsStore.subscribe((state, prev) => {
      if (isApplyingRemote) return;
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
  const settings = useSettingsStore.getState().settings;

  const supabase = getSupabase();

  if (recipes.length > 0) {
    await supabase.from('recipes').upsert(recipes.map((r) => recipeToRow(r, userId)));
  }
  if (entries.length > 0) {
    await supabase
      .from('meal_plan_entries')
      .upsert(entries.map((e) => mealEntryToRow(e, userId)), { onConflict: 'user_id,recipe_id' });
  }
  if (pantry.length > 0) {
    await supabase.from('pantry_items').upsert(pantry.map((p) => pantryToRow(p, userId)));
  }
  const overrideRows = Object.entries(overrides).map(([key, o]) => overrideToRow(o, key, userId));
  if (overrideRows.length > 0) {
    await supabase
      .from('price_overrides')
      .upsert(overrideRows, { onConflict: 'user_id,normalized_name' });
  }
  await supabase
    .from('user_settings')
    .upsert(settingsToRow(settings, userId), { onConflict: 'user_id' });

  await AsyncStorage.setItem(STORAGE_KEYS.migratedAccountId, userId);
}
