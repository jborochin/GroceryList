import { Meal } from '../types';

// Effort heuristic bounds. A meal at or below the low bound contributes 0 to
// that component (easiest); at or above the high bound it contributes 1.
const PREP_MIN = 5; // minutes
const PREP_MAX = 45;
const INGREDIENTS_MIN = 3;
const INGREDIENTS_MAX = 12;
const STEPS_MIN = 3;
const STEPS_MAX = 8;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalize(value: number, lo: number, hi: number): number {
  return clamp01((value - lo) / (hi - lo));
}

/**
 * How involved a meal is to cook, on a 0..1 scale (0 = easiest, 1 = hardest),
 * derived from prep time, ingredient count, and step count. Averages only the
 * components actually present so a meal missing `prepTimeMinutes` or
 * `instructions` still gets a sensible score from what's available; a meal with
 * no usable signal at all falls back to the neutral midpoint (0.5).
 *
 * Used by the planner to bias selection toward quick/simple or more elaborate
 * meals per the user's "prefer taste ↔ easy to cook" setting.
 */
export function mealEffortScore(meal: Meal): number {
  const components: number[] = [];

  if (typeof meal.prepTimeMinutes === 'number') {
    components.push(normalize(meal.prepTimeMinutes, PREP_MIN, PREP_MAX));
  }
  if (meal.ingredients.length > 0) {
    components.push(normalize(meal.ingredients.length, INGREDIENTS_MIN, INGREDIENTS_MAX));
  }
  if (meal.instructions && meal.instructions.length > 0) {
    components.push(normalize(meal.instructions.length, STEPS_MIN, STEPS_MAX));
  }

  if (components.length === 0) return 0.5;
  return components.reduce((a, b) => a + b, 0) / components.length;
}
