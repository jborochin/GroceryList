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
 */
export function servingOptions(item: Pick<FoodItem, 'servings'>): FoodServing[] {
  const out: FoodServing[] = [];
  const seen = new Set<string>();
  for (const s of item.servings) {
    const label = s.label.trim();
    if (!label || !(s.grams > 0)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, grams: s.grams });
  }
  if (!seen.has('g')) out.push(GRAM_SERVING);
  return out;
}

/**
 * Macros for `qty` of `serving`. Returns zeroes when the food has no per-100g
 * basis (a 'quick' entry), which the caller should treat as "type the numbers
 * in yourself" rather than as a real zero.
 */
export function nutritionForServing(
  per100g: NutritionPerServing | undefined,
  serving: FoodServing,
  qty: number
): NutritionPerServing {
  if (!per100g) return ZERO_NUTRITION;
  const grams = totalGrams(serving, qty);
  if (!(grams > 0)) return ZERO_NUTRITION;
  return scaleNutrition(per100g, grams / 100);
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
