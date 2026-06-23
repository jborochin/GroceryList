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
  imageUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MealPlanEntry {
  recipeId: string;
  desiredServings: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

// Device-local placement of a planned recipe onto a specific day + meal slot.
// This is the "calendar" layer that sits on top of the synced MealPlanEntry list:
// entries stay the authoritative (synced) source of plan membership + total
// servings, while cells only describe WHERE each serving lands in the week.
// Never synced — see useMealScheduleStore.
export interface ScheduleCell {
  id: string;
  day: number; // 0..6 (Mon..Sun)
  slot: MealSlot;
  recipeId: string;
  desiredServings: number;
}

// A curated catalog meal. Unlike Recipe, nutritionPerServing is required
// (the catalog is hand-authored) and it carries cuisine/slot/dietary metadata
// so the auto-planner can filter and score it. `id` is a stable slug — never
// change one, it seeds the deterministic recipe id on commit (see commitMealPlan).
export interface Meal {
  id: string;
  title: string;
  cuisine: string; // key from foodPreferences.json -> cuisines[].key
  slots: MealSlot[];
  dietaryTags: string[]; // restrictions this meal SATISFIES (foodPreferences.json -> dietary[].key)
  servings: number; // base servings the ingredient quantities describe (catalog meals use 1)
  ingredients: Ingredient[];
  nutritionPerServing: NutritionPerServing;
  prepTimeMinutes?: number;
  imageUrl?: string;
  instructions?: string[];
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

// How often the user wants to cook — drives meal-plan variety.
export type CookingFrequency = 'batch' | 'few_days' | 'daily';

export interface UserSettings {
  dailyCalorieTarget: number;
  macroSplit: { proteinPct: number; carbsPct: number; fatPct: number };
  macroGrams: { proteinG: number; carbsG: number; fatG: number };
  reduceVisualEffects: boolean;
  onboardingCompleted: boolean;
  tdeeInputs: TdeeInputs | null;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  cookingFrequency: CookingFrequency;
  // 0 = prefer taste (more elaborate meals) … 1 = easy to cook (quick/simple).
  // 0.5 is neutral; drives the auto meal planner's effort bias.
  cookingEasePreference: number;
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
