import { CookingFrequency, Meal, MealSlot, NutritionPerServing } from '../types';
import { mealEffortScore } from './mealEffort';
import { mulberry32 } from './seededRandom';

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
  // 0..1 bias between "prefer taste" (0, favor more elaborate meals) and "easy
  // to cook" (1, favor quick/simple meals). 0.5 (or omitted) is neutral and
  // leaves selection unchanged.
  cookingEasePreference?: number;
  // When set, the planner introduces reproducible variation: instead of always
  // taking the single best-scoring meal per slot, it picks (via this seed)
  // among the meals whose score is within SHUFFLE_BAND of the best. Omit for the
  // deterministic best plan (identical output to a seedless run).
  seed?: number;
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

// Per-meal effort nudge at full bias. Comparable to CUISINE_BONUS so it reorders
// similarly-fitting meals toward easier/harder without overriding macro fit.
const EASE_WEIGHT = 0.8;

// Per-prior-use score penalty, scaled by the user's cooking cadence:
// batch cook tolerates (even prefers) repeats; daily pushes for distinct meals.
// `few_days` is the long-standing default and keeps prior behavior unchanged.
const VARIETY_PENALTY_BY_FREQ: Record<CookingFrequency, number> = {
  batch: 0,
  few_days: 0.4,
  daily: 1.5,
};

// When shuffling, any candidate scoring within this much of the best is treated
// as comparably good and eligible for random selection. Scores are <= 0 (0 =
// perfect macro fit), so this band stays tight enough to keep macros on target
// while still surfacing variety. Capped at SHUFFLE_TOP_K candidates so a slot
// with many similar meals doesn't dilute toward weaker fits.
const SHUFFLE_BAND = 0.15;
const SHUFFLE_TOP_K = 4;

const EMPTY_NUTRITION: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function relErrSq(actual: number, target: number): number {
  const denom = Math.max(target, 1);
  const e = (actual - target) / denom;
  return e * e;
}

// Macro-fit core shared by the planner's per-slot scoring and the deck's
// whole-day ordering. <= 0, with 0 = a perfect match; protein weighted 3x as
// it's usually the binding macro for meal-prep goals.
function macroFit(n: NutritionPerServing, target: NutritionPerServing): number {
  return -(
    W_CALORIES * relErrSq(n.calories, target.calories) +
    W_PROTEIN * relErrSq(n.proteinG, target.proteinG) +
    W_CARBS * relErrSq(n.carbsG, target.carbsG) +
    W_FAT * relErrSq(n.fatG, target.fatG)
  );
}

/**
 * Whole-day macro fit for one meal (single serving) against the daily target,
 * used to order the cookbook swipe deck best-first. No cuisine/variety
 * adjustment — pure macro proximity, weighted like the planner (protein 3x).
 * Higher is better.
 */
export function mealFitScore(
  nutrition: NutritionPerServing,
  targets: PlannerTargets
): number {
  return macroFit(nutrition, {
    calories: targets.dailyCalories,
    proteinG: targets.macroGrams.proteinG,
    carbsG: targets.macroGrams.carbsG,
    fatG: targets.macroGrams.fatG,
  });
}

// Higher is better. macroFit is <= 0 (0 = perfect match); cuisine preference
// adds, repeated use subtracts.
function score(
  meal: Meal,
  servings: number,
  target: NutritionPerServing,
  cuisinePreferences: string[],
  priorUses: number,
  varietyPenalty: number,
  easeBias: number
): number {
  const n = meal.nutritionPerServing;
  const fit = macroFit(
    {
      calories: n.calories * servings,
      proteinG: n.proteinG * servings,
      carbsG: n.carbsG * servings,
      fatG: n.fatG * servings,
    },
    target
  );
  const cuisineBonus = cuisinePreferences.includes(meal.cuisine) ? CUISINE_BONUS : 0;
  // easeBias > 0 rewards low-effort meals, < 0 rewards higher-effort ones.
  const easeBonus = easeBias !== 0 ? EASE_WEIGHT * easeBias * (0.5 - mealEffortScore(meal)) : 0;
  return fit + cuisineBonus + easeBonus - varietyPenalty * priorUses;
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
 * Deterministic by default: no randomness; candidates are pre-sorted by id and
 * ties are broken by lexical id order. When `input.seed` is set, each slot
 * instead picks randomly (reproducibly, from the seed) among the meals scoring
 * within SHUFFLE_BAND of the best — adding variety without sacrificing macro fit.
 */
export function planMeals(input: PlannerInput): PlannerResult {
  const { targets, cuisinePreferences, dietaryRestrictions, meals, days, slots } = input;
  const varietyPenalty = VARIETY_PENALTY_BY_FREQ[input.cookingFrequency ?? 'few_days'];
  // Map the 0..1 ease preference to a [-1, 1] bias; 0.5 (or omitted) → 0 (no effect).
  const easeBias = ((input.cookingEasePreference ?? 0.5) - 0.5) * 2;
  const rng = input.seed !== undefined ? mulberry32(input.seed) : null;

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

      // Score every candidate, then either take the strict best (seedless,
      // deterministic) or randomly pick among the top band of comparably-good
      // meals (seeded — adds variety while keeping macro fit tight).
      const scored = candidates.map((meal) => {
        const servings = chooseServings(meal, instanceTarget);
        const s = score(
          meal,
          servings,
          instanceTarget,
          cuisinePreferences,
          uses.get(meal.id) ?? 0,
          varietyPenalty,
          easeBias
        );
        return { meal, servings, s };
      })
        // A NaN score (NaN targets, a meal with NaN macros) compares false with
        // everything: the seedless argmax skips it, but the seeded band filter
        // would produce an empty band and `band[i].meal` would throw.
        .filter((c) => Number.isFinite(c.s));

      let best: Meal | null = null;
      let bestServings = 1;
      if (scored.length > 0) {
        if (rng) {
          // Ranked desc by score; ties broken by id to keep the band stable
          // across runs so a given seed always sees the same candidate set.
          scored.sort((a, b) =>
            b.s !== a.s ? b.s - a.s : a.meal.id < b.meal.id ? -1 : 1
          );
          const bestScore = scored[0].s;
          const band = scored
            .filter((c) => bestScore - c.s <= SHUFFLE_BAND)
            .slice(0, SHUFFLE_TOP_K);
          const pick = band[Math.floor(rng() * band.length)];
          best = pick.meal;
          bestServings = pick.servings;
        } else {
          // Strict argmax with lexical-id tie-break (first candidate is already
          // the smallest id), matching the original deterministic behavior.
          let bestScore = -Infinity;
          for (const c of scored) {
            if (c.s > bestScore) {
              bestScore = c.s;
              best = c.meal;
              bestServings = c.servings;
            }
          }
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
