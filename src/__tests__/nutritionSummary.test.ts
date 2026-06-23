import { computeNutritionSummary } from '../utils/nutritionSummary';
import type { MealPlanEntry, Recipe, UserSettings } from '../types';

const settings: UserSettings = {
  dailyCalorieTarget: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  macroGrams: { proteinG: 150, carbsG: 200, fatG: 67 },
  reduceVisualEffects: false,
  onboardingCompleted: true,
  tdeeInputs: null,
  cuisinePreferences: [],
  dietaryRestrictions: [],
  cookingFrequency: 'few_days',
  cookingEasePreference: 0.5,
};

function recipe(id: string, calories: number, proteinG: number): Recipe {
  return {
    id,
    title: id,
    servings: 1,
    ingredients: [],
    nutritionPerServing: { calories, proteinG, carbsG: 0, fatG: 0 },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('computeNutritionSummary', () => {
  const recipes = [recipe('a', 700, 50)];
  const plan: MealPlanEntry[] = [{ recipeId: 'a', desiredServings: 21 }];

  it('defaults to a 7-day week', () => {
    const s = computeNutritionSummary(plan, recipes, settings);
    expect(s.weekly.calories).toBe(700 * 21);
    expect(s.daily.calories).toBeCloseTo((700 * 21) / 7, 5);
  });

  it('divides daily totals by planDays when provided', () => {
    const s = computeNutritionSummary(plan, recipes, settings, 3);
    expect(s.daily.calories).toBeCloseTo((700 * 21) / 3, 5);
    expect(s.daily.proteinG).toBeCloseTo((50 * 21) / 3, 5);
  });

  it('guards against planDays below 1', () => {
    const s = computeNutritionSummary(plan, recipes, settings, 0);
    expect(s.daily.calories).toBe(700 * 21);
  });

  it('flags missing nutrition data', () => {
    const noNutrition: Recipe = { ...recipe('b', 0, 0), nutritionPerServing: undefined };
    const s = computeNutritionSummary(
      [{ recipeId: 'b', desiredServings: 1 }],
      [noNutrition],
      settings
    );
    expect(s.hasMissingData).toBe(true);
  });

  it('computes variance against targets', () => {
    // 2000 cal/day exactly on target → 0% variance
    const r = recipe('c', 1000, 0);
    const s = computeNutritionSummary([{ recipeId: 'c', desiredServings: 14 }], [r], settings, 7);
    expect(s.variancePct.calories).toBeCloseTo(0, 5);
  });
});
