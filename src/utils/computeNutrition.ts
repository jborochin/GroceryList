import { NutritionPerServing } from '../types';
import { parseIngredient } from './ingredientParser';
import { normalizeName } from './normalizeName';
import {
  coreFoodName,
  estimateNutrition as estimateFromProvider,
  FoodNutrition,
  FoodProvider,
} from './nutritionEstimator';

// Recipe-level nutrition estimate: the whole-recipe total and the per-serving
// figure (total ÷ servings). Callers use `perRecipe` vs `perServing` to detect
// whether a site's published nutrition is a recipe total or already per serving
// (see reconcileNutritionBasis in recipeUrlParser).
export interface NutritionEstimate {
  perRecipe: NutritionPerServing;
  perServing: NutritionPerServing;
}

interface UsdaFood {
  name: string;
  per100g: NutritionPerServing;
  portions?: Record<string, number>;
}

interface UsdaResponse {
  ok: boolean;
  foods?: UsdaFood[];
}

interface CalorieNinjasResponse {
  ok: boolean;
  perRecipe?: NutritionPerServing;
  perServing?: NutritionPerServing;
}

interface InvokeResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

interface SupabaseLike {
  functions: {
    invoke<T>(slug: string, opts: { body: Record<string, unknown> }): Promise<InvokeResult<T>>;
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// Primary engine: USDA FoodData Central. Resolves each unique ingredient name to
// per-100g macros + household-measure portions, then sums client-side with the
// pure estimator (quantity→gram conversion lives in nutritionEstimator).
async function estimateViaUsda(
  ingredientStrings: string[],
  servings: number,
  supabase: SupabaseLike,
): Promise<NutritionEstimate | null> {
  const parsed = ingredientStrings.map(parseIngredient).filter((p) => p.name);
  if (parsed.length === 0) return null;
  const names = uniq(parsed.map((p) => normalizeName(coreFoodName(p.name))));
  const { data, error } = await supabase.functions.invoke<UsdaResponse>('usda-nutrition', {
    body: { foods: names },
  });
  if (error || !data || !data.ok || !Array.isArray(data.foods) || data.foods.length === 0) {
    return null;
  }
  const map = new Map<string, FoodNutrition>();
  for (const f of data.foods) {
    if (f && f.name && f.per100g) map.set(f.name, { per100g: f.per100g, portions: f.portions });
  }
  if (map.size === 0) return null;
  const provider: FoodProvider = (norm) => map.get(norm) ?? null;
  const est = estimateFromProvider(parsed, servings, provider);
  // If we matched almost nothing the total is meaningless — let the caller fall back.
  if (est.itemsMatched === 0 || est.perRecipe.calories <= 0) return null;
  return { perRecipe: est.perRecipe, perServing: est.perServing };
}

// Fallback engine: the legacy CalorieNinjas edge function, which already returns
// both perRecipe and perServing. Keeps imports working before usda-nutrition is
// deployed/keyed, and covers ingredients USDA can't resolve.
async function estimateViaCalorieNinjas(
  ingredientStrings: string[],
  servings: number,
  supabase: SupabaseLike,
): Promise<NutritionEstimate | null> {
  const cleaned = ingredientStrings.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const { data, error } = await supabase.functions.invoke<CalorieNinjasResponse>('compute-nutrition', {
    body: { ingredients: cleaned, servings: Math.max(1, servings) },
  });
  if (error || !data || !data.ok || !data.perRecipe || !data.perServing) return null;
  return { perRecipe: data.perRecipe, perServing: data.perServing };
}

/**
 * Estimate recipe nutrition (perRecipe total + perServing) from raw ingredient
 * strings. Prefers the USDA engine; falls back to CalorieNinjas. Fails open —
 * returns null when nothing is configured/reachable so callers can degrade.
 */
export async function estimateNutrition(
  ingredientStrings: string[],
  servings: number,
): Promise<NutritionEstimate | null> {
  const cleaned = ingredientStrings.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  try {
    // Lazy import — supabase pulls in native polyfills that break Jest.
    const { getSupabase, supabaseConfigured } = await import('../lib/supabase');
    if (!supabaseConfigured) return null;
    const supabase = getSupabase();
    const viaUsda = await estimateViaUsda(cleaned, servings, supabase);
    if (viaUsda) return viaUsda;
    return await estimateViaCalorieNinjas(cleaned, servings, supabase);
  } catch {
    return null;
  }
}

/**
 * Backwards-compatible helper: returns only the requested per-serving macros that
 * the page didn't provide. Now a thin wrapper over estimateNutrition.
 */
export async function computeMissingMacros(
  ingredientStrings: string[],
  servings: number,
  missing: Array<keyof NutritionPerServing>,
): Promise<Partial<NutritionPerServing> | null> {
  if (missing.length === 0) return null;
  const est = await estimateNutrition(ingredientStrings, servings);
  if (!est) return null;
  const out: Partial<NutritionPerServing> = {};
  for (const key of missing) {
    const v = est.perServing[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
