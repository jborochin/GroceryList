import { ActivityLevel, Goal, Sex, TdeeInputs, UserSettings } from '../types';
import {
  KCAL_PER_G_CARBS,
  KCAL_PER_G_FAT,
  KCAL_PER_G_PROTEIN,
} from './nutritionSummary';

// Mifflin-St Jeor BMR; treat anything outside these ranges as bad data and
// return null from the public entry points so the UI can disable submit.
const AGE_RANGE_YEARS = { min: 13, max: 120 } as const;
const HEIGHT_RANGE_CM = { min: 100, max: 250 } as const;
const WEIGHT_RANGE_KG = { min: 30, max: 300 } as const;
const CALORIE_FLOOR = 1200;

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT_KCAL: Record<Goal, number> = {
  lose: -500,
  maintain: 0,
  gain: 500,
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function inRange(n: number, range: { min: number; max: number }): boolean {
  return n >= range.min && n <= range.max;
}

export function mifflinStJeor(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
}): number {
  const { sex, weightKg, heightCm, age } = input;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function applyActivity(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity];
}

export function applyGoal(tdee: number, goal: Goal): number {
  return Math.max(CALORIE_FLOOR, tdee + GOAL_ADJUSTMENT_KCAL[goal]);
}

export function computeTargetCalories(inputs: TdeeInputs): number | null {
  const { sex, age, heightCm, weightKg, activity, goal } = inputs;
  if (
    !isFiniteNumber(age) ||
    !isFiniteNumber(heightCm) ||
    !isFiniteNumber(weightKg) ||
    !inRange(age, AGE_RANGE_YEARS) ||
    !inRange(heightCm, HEIGHT_RANGE_CM) ||
    !inRange(weightKg, WEIGHT_RANGE_KG) ||
    (sex !== 'male' && sex !== 'female')
  ) {
    return null;
  }
  const bmr = mifflinStJeor({ sex, weightKg, heightCm, age });
  const tdee = applyActivity(bmr, activity);
  return Math.round(applyGoal(tdee, goal));
}

export function macroGramsFromSplit(
  calories: number,
  split: UserSettings['macroSplit']
): UserSettings['macroGrams'] {
  return {
    proteinG: Math.round((calories * split.proteinPct) / 100 / KCAL_PER_G_PROTEIN),
    carbsG: Math.round((calories * split.carbsPct) / 100 / KCAL_PER_G_CARBS),
    fatG: Math.round((calories * split.fatPct) / 100 / KCAL_PER_G_FAT),
  };
}

// ---------- Unit conversion ----------

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function inToCm(inches: number): number {
  return inches * CM_PER_IN;
}

export function cmToIn(cm: number): number {
  return cm / CM_PER_IN;
}

export function ftInToCm(feet: number, inches: number): number {
  return inToCm(feet * 12 + inches);
}

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalIn = cmToIn(cm);
  const feet = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - feet * 12);
  if (inches === 12) return { feet: feet + 1, inches: 0 };
  return { feet, inches };
}

export const TDEE_RANGES = {
  age: AGE_RANGE_YEARS,
  heightCm: HEIGHT_RANGE_CM,
  weightKg: WEIGHT_RANGE_KG,
} as const;
