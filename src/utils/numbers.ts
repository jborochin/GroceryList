import { NutritionPerServing } from '../types';

/**
 * Coerce to a finite number, or fall back.
 *
 * Every boundary that turns server rows, imported JSON-LD, or persisted blobs into
 * app state goes through this instead of a bare `Number(x)`. A single NaN admitted
 * at one of those boundaries is not contained: `Math.max(1, NaN)` is NaN, so it
 * survives every clamp, poisons every sum it touches (`$NaN` on the grocery total),
 * and makes every comparison false (the seeded planner then indexes an empty band
 * and throws).
 */
export function finiteOr(value: unknown, fallback: number): number {
  // null/undefined/blank are "absent", not zero: Number(null) is 0, and a NULL
  // calorie column must not become a 0-calorie target.
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Like finiteOr, but also rejects zero and negatives — for servings, quantities, prices. */
export function positiveOr(value: unknown, fallback: number): number {
  const n = finiteOr(value, fallback);
  return n > 0 ? n : fallback;
}

/** Coerce an untrusted object into a nutrition record; anything missing, non-finite or negative is 0. */
export function toNutrition(value: unknown): NutritionPerServing {
  const n = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<
    Record<keyof NutritionPerServing, unknown>
  >;
  const nonNeg = (v: unknown) => Math.max(0, finiteOr(v, 0));
  return {
    calories: nonNeg(n.calories),
    proteinG: nonNeg(n.proteinG),
    carbsG: nonNeg(n.carbsG),
    fatG: nonNeg(n.fatG),
  };
}
