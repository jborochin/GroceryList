import { NutritionPerServing } from '../types';

interface ComputeNutritionResponse {
  ok: boolean;
  perServing?: NutritionPerServing;
  kind?: string;
  message?: string;
}

export async function computeMissingMacros(
  ingredientStrings: string[],
  servings: number,
  missing: Array<keyof NutritionPerServing>,
): Promise<Partial<NutritionPerServing> | null> {
  if (missing.length === 0) return null;
  if (ingredientStrings.length === 0) return null;
  const cleaned = ingredientStrings.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  try {
    // Lazy import — supabase pulls in native polyfills that break Jest.
    const { getSupabase, supabaseConfigured } = await import('../lib/supabase');
    if (!supabaseConfigured) return null;
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke<ComputeNutritionResponse>('compute-nutrition', {
      body: { ingredients: cleaned, servings: Math.max(1, servings) },
    });
    if (error || !data || !data.ok || !data.perServing) return null;
    const out: Partial<NutritionPerServing> = {};
    for (const key of missing) {
      const v = data.perServing[key];
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
