import { Ingredient, NutritionPerServing, Recipe } from '../types';

export function scaleIngredients(ingredients: Ingredient[], ratio: number): Ingredient[] {
  return ingredients.map((i) => ({ ...i, quantity: i.quantity * ratio }));
}

export function scaleNutrition(n: NutritionPerServing | undefined, servings: number): NutritionPerServing | undefined {
  if (!n) return undefined;
  return {
    calories: n.calories * servings,
    proteinG: n.proteinG * servings,
    carbsG: n.carbsG * servings,
    fatG: n.fatG * servings,
  };
}

export function scaleRecipe(recipe: Recipe, desiredServings: number): Recipe {
  const ratio = desiredServings / Math.max(1, recipe.servings);
  return {
    ...recipe,
    servings: desiredServings,
    ingredients: scaleIngredients(recipe.ingredients, ratio),
  };
}
