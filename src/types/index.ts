export type UnitFamily = 'volume' | 'weight' | 'count';

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  raw?: string;
}

export interface NutritionPerServing {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Recipe {
  id: string;
  title: string;
  sourceUrl?: string;
  servings: number;
  ingredients: Ingredient[];
  instructions?: string[];
  nutritionPerServing?: NutritionPerServing;
  createdAt: number;
  updatedAt: number;
}

export interface MealPlanEntry {
  recipeId: string;
  desiredServings: number;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity?: number;
  unit?: string;
}

export interface ManualItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'lose' | 'maintain' | 'gain';
export type UnitSystem = 'imperial' | 'metric';

export interface TdeeInputs {
  v: 1;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: Goal;
  unitSystem: UnitSystem;
}

export interface UserSettings {
  dailyCalorieTarget: number;
  macroSplit: { proteinPct: number; carbsPct: number; fatPct: number };
  macroGrams: { proteinG: number; carbsG: number; fatG: number };
  reduceVisualEffects: boolean;
  onboardingCompleted: boolean;
  tdeeInputs: TdeeInputs | null;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
}

export interface PriceOverride {
  name: string;
  pricePerUnit: number;
  unit: string;
}

export type PriceReason = 'no-match' | 'unit-conflict';

export interface GroceryEntry {
  quantity: number;
  unit: string;
  price?: number;
  priceReason?: PriceReason;
}

export interface GroceryItem {
  name: string;
  displayName: string;
  category: string;
  entries: GroceryEntry[];
  estimatedPrice?: number;
  hasPriceGap: boolean;
}

export interface PriceEntry {
  pricePerUnit: number;
  unit: string;
}

export interface NutritionSummary {
  weekly: NutritionPerServing;
  daily: NutritionPerServing;
  hasMissingData: boolean;
  target: {
    dailyCalories: number;
    dailyProteinG: number;
    dailyCarbsG: number;
    dailyFatG: number;
  };
  variancePct: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}
