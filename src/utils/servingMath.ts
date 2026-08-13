import { FoodItem, FoodServing, NutritionPerServing } from '../types';
import { scaleNutrition, ZERO_NUTRITION } from './foodLogDay';

// Turn "2 × 1 container (170 g)" of a food into the macros that get snapshotted
// into a FoodLogEntry.
//
// Both USDA FoodData Central and Open Food Facts publish nutrition per 100 g, so
// grams are the only basis this needs — a serving is just a named gram weight.
// That is why FoodServing carries `grams` rather than a unit: it sidesteps
// unitConversion.ts entirely, and with it the whole volume/weight/count family
// problem that the grocery pipeline has to solve.

/** The serving every food can always offer, so the picker is never empty. */
export const GRAM_SERVING: FoodServing = { label: 'g', grams: 1 };

/**
 * Serving options for the picker: whatever the source published, plus a plain
 * gram entry as the last resort. Deduped by label, source order preserved —
 * FDC and OFF both list the most representative portion first.
 *
 * A zero-gram serving is kept ONLY when the food carries `perServing` macros,
 * because that is the one case where an unweighable portion can still be
 * priced in calories. Offering it otherwise would put a guaranteed 0 kcal
 * option in the picker.
 */
export function servingOptions(item: Pick<FoodItem, 'servings' | 'perServing'>): FoodServing[] {
  const out: FoodServing[] = [];
  const seen = new Set<string>();
  for (const s of item.servings) {
    const label = s.label.trim();
    const weighable = s.grams > 0;
    if (!label) continue;
    if (!weighable && !item.perServing) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, grams: weighable ? s.grams : 0 });
  }
  // A perServing food has no mass, so grams would only ever produce zeroes.
  if (!seen.has('g') && !(item.perServing && out.length > 0)) out.push(GRAM_SERVING);
  return out;
}

/**
 * Macros for `qty` of `serving`.
 *
 * Two bases, because foods arrive with two different kinds of knowledge:
 *  - `per100g` — what FoodData Central and Open Food Facts publish. Scales to
 *    any portion, so it wins whenever it exists.
 *  - `perServing` — what a person knows about their own cooking. A bowl of
 *    homemade chilli is 400 kcal; nobody weighed it. Scaling that by quantity
 *    is still exactly right, it just can't be converted to grams.
 *
 * Returns zeroes only when there is no basis at all (a 'quick' entry), which the
 * caller should treat as "type the numbers in yourself", not as a real zero.
 */
export function nutritionForServing(
  item: Pick<FoodItem, 'per100g' | 'perServing'>,
  serving: FoodServing,
  qty: number
): NutritionPerServing {
  if (!Number.isFinite(qty) || qty <= 0) return ZERO_NUTRITION;

  const grams = totalGrams(serving, qty);
  if (item.per100g && grams > 0) return scaleNutrition(item.per100g, grams / 100);

  // No mass to scale by — fall back to counting servings.
  if (item.perServing) return scaleNutrition(item.perServing, qty);

  return ZERO_NUTRITION;
}

/** Total gram weight of `qty` of `serving`. */
export function totalGrams(serving: FoodServing, qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!Number.isFinite(serving.grams) || serving.grams <= 0) return 0;
  return serving.grams * qty;
}

/** Round a macro set for display/storage: calories whole, macros to 0.1 g. */
export function roundNutrition(n: NutritionPerServing): NutritionPerServing {
  return {
    calories: Math.round(n.calories),
    proteinG: Math.round(n.proteinG * 10) / 10,
    carbsG: Math.round(n.carbsG * 10) / 10,
    fatG: Math.round(n.fatG * 10) / 10,
  };
}
