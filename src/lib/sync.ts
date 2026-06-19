import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostgrestError } from '@supabase/supabase-js';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { STORAGE_KEYS } from '../store/storage';
import {
  CookingFrequency,
  MealPlanEntry,
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
    cooking_frequency: s.cookingFrequency,
    tdee_inputs: s.tdeeInputs,
  };
}

function asCookingFrequency(v: unknown): CookingFrequency {
  return v === 'batch' || v === 'few_days' || v === 'daily' ? v : 'few_days';
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
    const snapSettings = useSettingsStore.getState().settings;

    // Fetch INCLUDING soft-deleted rows: without tombstones, a remotely
    // deleted item is indistinguishable from a never-pushed local creation,
    // and the merge would push it back to life.
    const [recipes, meals, pantry, overrides, settings] = await Promise.all([
      supabase.from('recipes').select('*').eq('user_id', userId),
      supabase.from('meal_plan_entries').select('*').eq('user_id', userId),
      supabase.from('pantry_items').select('*').eq('user_id', userId),
      supabase.from('price_overrides').select('*').eq('user_id', userId),
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
      !recipes.error && !meals.error && !pantry.error && !overrides.error && !settings.error;
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
