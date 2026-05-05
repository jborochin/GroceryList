import { MealPlanEntry, NutritionSummary, Recipe, UserSettings } from '../types';

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

export function computeNutritionSummary(
  plan: MealPlanEntry[],
  recipes: Recipe[],
  settings: UserSettings
): NutritionSummary {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let hasMissingData = false;

  for (const entry of plan) {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) continue;
    if (!recipe.nutritionPerServing) {
      hasMissingData = true;
      continue;
    }
    const n = recipe.nutritionPerServing;
    calories += n.calories * entry.desiredServings;
    proteinG += n.proteinG * entry.desiredServings;
    carbsG += n.carbsG * entry.desiredServings;
    fatG += n.fatG * entry.desiredServings;
  }

  const weekly = { calories, proteinG, carbsG, fatG };
  const daily = {
    calories: calories / 7,
    proteinG: proteinG / 7,
    carbsG: carbsG / 7,
    fatG: fatG / 7,
  };

  const { dailyCalorieTarget, macroSplit } = settings;
  const target = {
    dailyCalories: dailyCalorieTarget,
    dailyProteinG: (dailyCalorieTarget * macroSplit.proteinPct) / 100 / KCAL_PER_G_PROTEIN,
    dailyCarbsG: (dailyCalorieTarget * macroSplit.carbsPct) / 100 / KCAL_PER_G_CARBS,
    dailyFatG: (dailyCalorieTarget * macroSplit.fatPct) / 100 / KCAL_PER_G_FAT,
  };

  const variancePct = {
    calories: pct(daily.calories, target.dailyCalories),
    protein: pct(daily.proteinG, target.dailyProteinG),
    carbs: pct(daily.carbsG, target.dailyCarbsG),
    fat: pct(daily.fatG, target.dailyFatG),
  };

  return { weekly, daily, hasMissingData, target, variancePct };
}

function pct(actual: number, target: number): number {
  if (target === 0) return 0;
  return ((actual - target) / target) * 100;
}
