import { CookingFrequency, Meal, MealSlot, NutritionPerServing } from '../types';

export interface SlotConfig {
  slot: MealSlot;
  mealsPerDay: number;
}

export interface PlannerTargets {
  dailyCalories: number;
  macroGrams: { proteinG: number; carbsG: number; fatG: number };
}

export interface PlannerInput {
  targets: PlannerTargets;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  meals: Meal[];
  days: number;
  slots: SlotConfig[];
  cookingFrequency?: CookingFrequency;
}

export interface PlannedItem {
  day: number; // 0-indexed
  slot: MealSlot;
  mealId: string;
  servings: number;
}

export interface PlannerResult {
  items: PlannedItem[];
  dailyTotals: NutritionPerServing[];
  unfilledSlots: number;
}

// Relative share of the daily budget each slot type is expected to carry.
const SLOT_WEIGHT: Record<MealSlot, number> = {
  breakfast: 25,
  lunch: 30,
  dinner: 35,
  snack: 12,
};

// Fill larger contributors first so smaller slots absorb the leftover budget.
const FILL_ORDER: MealSlot[] = ['dinner', 'lunch', 'breakfast', 'snack'];

// Scoring weights — protein is usually the binding macro for meal-prep goals.
const W_CALORIES = 2;
const W_PROTEIN = 3;
const W_CARBS = 1;
const W_FAT = 1;
const CUISINE_BONUS = 0.5;

// Per-prior-use score penalty, scaled by the user's cooking cadence:
// batch cook tolerates (even prefers) repeats; daily pushes for distinct meals.
// `few_days` is the long-standing default and keeps prior behavior unchanged.
const VARIETY_PENALTY_BY_FREQ: Record<CookingFrequency, number> = {
  batch: 0,
  few_days: 0.4,
  daily: 1.5,
};

const EMPTY_NUTRITION: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function relErrSq(actual: number, target: number): number {
  const denom = Math.max(target, 1);
  const e = (actual - target) / denom;
  return e * e;
}

// Higher is better. macroFit is <= 0 (0 = perfect match); cuisine preference
// adds, repeated use subtracts.
function score(
  meal: Meal,
  servings: number,
  target: NutritionPerServing,
  cuisinePreferences: string[],
  priorUses: number,
  varietyPenalty: number
): number {
  const n = meal.nutritionPerServing;
  const macroFit = -(
    W_CALORIES * relErrSq(n.calories * servings, target.calories) +
    W_PROTEIN * relErrSq(n.proteinG * servings, target.proteinG) +
    W_CARBS * relErrSq(n.carbsG * servings, target.carbsG) +
    W_FAT * relErrSq(n.fatG * servings, target.fatG)
  );
  const cuisineBonus = cuisinePreferences.includes(meal.cuisine) ? CUISINE_BONUS : 0;
  return macroFit + cuisineBonus - varietyPenalty * priorUses;
}

// Pick 1 or 2 servings — 2 only when a single serving badly under-shoots the
// protein sub-target and doubling stays within a reasonable calorie ceiling.
function chooseServings(meal: Meal, target: NutritionPerServing): number {
  const n = meal.nutritionPerServing;
  const undershootsProtein = target.proteinG > 0 && n.proteinG < 0.6 * target.proteinG;
  const calorieRoom = n.calories * 2 <= target.calories * 1.4;
  return undershootsProtein && calorieRoom ? 2 : 1;
}

function passesDietary(meal: Meal, restrictions: string[]): boolean {
  return restrictions.every((r) => meal.dietaryTags.includes(r));
}

/**
 * Greedy, deterministic meal planner. For each day it allocates the daily
 * calorie/macro target across the configured slot instances (weighted by slot
 * type), then fills each instance with the best-scoring eligible meal, tracking
 * the running remaining budget so later picks correct for earlier over/under.
 *
 * Deterministic: no randomness; candidates are pre-sorted by id and ties are
 * broken by lexical id order.
 */
export function planMeals(input: PlannerInput): PlannerResult {
  const { targets, cuisinePreferences, dietaryRestrictions, meals, days, slots } = input;
  const varietyPenalty = VARIETY_PENALTY_BY_FREQ[input.cookingFrequency ?? 'few_days'];

  const eligible = meals
    .filter((m) => passesDietary(m, dietaryRestrictions))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const candidatesBySlot = new Map<MealSlot, Meal[]>();
  for (const slot of FILL_ORDER) {
    candidatesBySlot.set(
      slot,
      eligible.filter((m) => m.slots.includes(slot))
    );
  }

  // Flatten the per-day slot instances into the fill order.
  const slotInstances: MealSlot[] = [];
  for (const slot of FILL_ORDER) {
    const cfg = slots.find((s) => s.slot === slot);
    const count = cfg ? Math.max(0, Math.floor(cfg.mealsPerDay)) : 0;
    for (let i = 0; i < count; i++) slotInstances.push(slot);
  }

  const items: PlannedItem[] = [];
  const dailyTotals: NutritionPerServing[] = [];
  const uses = new Map<string, number>();
  let unfilledSlots = 0;

  for (let day = 0; day < days; day++) {
    const remaining: NutritionPerServing = {
      calories: targets.dailyCalories,
      proteinG: targets.macroGrams.proteinG,
      carbsG: targets.macroGrams.carbsG,
      fatG: targets.macroGrams.fatG,
    };
    let remainingWeight = slotInstances.reduce((acc, s) => acc + SLOT_WEIGHT[s], 0);
    const dayTotal: NutritionPerServing = { ...EMPTY_NUTRITION };

    for (const slot of slotInstances) {
      const weight = SLOT_WEIGHT[slot];
      const share = remainingWeight > 0 ? weight / remainingWeight : 1;
      const instanceTarget: NutritionPerServing = {
        calories: remaining.calories * share,
        proteinG: remaining.proteinG * share,
        carbsG: remaining.carbsG * share,
        fatG: remaining.fatG * share,
      };
      remainingWeight -= weight;

      const candidates = candidatesBySlot.get(slot) ?? [];
      if (candidates.length === 0) {
        unfilledSlots++;
        continue;
      }

      let best: Meal | null = null;
      let bestServings = 1;
      let bestScore = -Infinity;
      for (const meal of candidates) {
        const servings = chooseServings(meal, instanceTarget);
        const s = score(
          meal,
          servings,
          instanceTarget,
          cuisinePreferences,
          uses.get(meal.id) ?? 0,
          varietyPenalty
        );
        if (s > bestScore) {
          bestScore = s;
          best = meal;
          bestServings = servings;
        }
      }
      if (!best) {
        unfilledSlots++;
        continue;
      }

      items.push({ day, slot, mealId: best.id, servings: bestServings });
      uses.set(best.id, (uses.get(best.id) ?? 0) + 1);

      const n = best.nutritionPerServing;
      remaining.calories -= n.calories * bestServings;
      remaining.proteinG -= n.proteinG * bestServings;
      remaining.carbsG -= n.carbsG * bestServings;
      remaining.fatG -= n.fatG * bestServings;
      dayTotal.calories += n.calories * bestServings;
      dayTotal.proteinG += n.proteinG * bestServings;
      dayTotal.carbsG += n.carbsG * bestServings;
      dayTotal.fatG += n.fatG * bestServings;
    }

    dailyTotals.push(dayTotal);
  }

  return { items, dailyTotals, unfilledSlots };
}
