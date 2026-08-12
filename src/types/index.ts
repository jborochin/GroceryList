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

// A recipe whose ingredients should land on the grocery list WITHOUT being
// planned — "add to grocery list" from a recipe/catalog detail screen. Kept out
// of MealPlanEntry on purpose: plan entries are synced, are reconciled from
// schedule cells, feed the nutrition summary, and render on the Week tab (any
// entry with no cell shows up in its "unscheduled" strip). Same shape as
// MealPlanEntry so both can be fed to aggregate() together — a recipe in both
// lists contributes twice, which is the intended "double batch".
export interface GroceryRecipeEntry {
  recipeId: string;
  desiredServings: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

// Device-local placement of a planned recipe onto a specific week + day + slot.
// This is the "calendar" layer that sits on top of the synced MealPlanEntry list:
// entries stay the authoritative (synced) source of plan membership + total
// servings — projected from ONE week at a time (the selected week, see
// useMealScheduleStore) — while cells describe WHERE each serving lands.
// Never synced — see useMealScheduleStore.
export interface ScheduleCell {
  id: string;
  weekStart: string; // week key: local ISO date of the week's Monday (see planningWeek.ts)
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

// ---------------------------------------------------------------------------
// Food logging (the Log tab)
// ---------------------------------------------------------------------------

// Where a logged food's numbers came from.
// - 'usda'   — USDA FoodData Central (branded products and whole foods)
// - 'off'    — Open Food Facts (barcode fallback when FDC has no UPC match)
// - 'custom' — a CustomFood the user defined by hand
// - 'recipe' — one of the user's own Recipes / a catalog meal clone
// - 'quick'  — bare calories typed in with no food behind them
export type FoodSource = 'usda' | 'off' | 'custom' | 'recipe' | 'quick';

// One selectable portion of a food, always anchored to grams so servingMath can
// scale per-100g nutrition. `label` is what the source calls it ("1 container",
// "2 tbsp") and is shown verbatim.
export interface FoodServing {
  label: string;
  grams: number;
}

// A search result. NOT persisted — logging snapshots it into a FoodLogEntry.
export interface FoodItem {
  source: FoodSource;
  sourceId: string;
  name: string;
  brand?: string;
  barcode?: string;
  // Per 100 g, the basis both FDC and Open Food Facts publish. Absent only for
  // 'quick' entries, which carry no scalable basis.
  per100g?: NutritionPerServing;
  // Household measures offered in the serving picker, most useful first. May be
  // empty, in which case the picker falls back to grams.
  servings: FoodServing[];
}

// One thing the user actually ate, on one date, in one slot.
//
// `nutrition` is the TOTAL for this entry as logged — already multiplied by
// servingQty — and is a snapshot, never a pointer to an fdcId. The app is
// offline-first and USDA/OFF rows change under us; a diary that silently
// rewrites last month's calories is broken. Same reasoning as
// Recipe.nutritionPerServing.
//
// At most one of fromCellId/replacesCellId is set, both referring to a
// ScheduleCell on the day's plan:
// - fromCellId    — "I ate the planned meal" (the *Ate this* button).
// - replacesCellId — "I ate something else instead" (*Ate other*). The plan
//   cell deliberately survives: the ingredients are already on the grocery
//   list because they were already bought.
// Either way resolveDay() stops projecting that cell.
//
// The schedule is device-local while this table syncs, so on a second device
// these ids dangle. That is harmless — device B has no cells to suppress, so it
// simply renders the logged entry.
export interface FoodLogEntry {
  id: string;
  date: string; // local ISO date key, YYYY-MM-DD (see planningWeek.ts)
  slot: MealSlot;
  displayName: string;
  brand?: string;
  source: FoodSource;
  sourceId?: string;
  barcode?: string;
  servingQty: number;
  servingLabel: string; // the FoodServing label chosen, or 'g'
  gramsPerServing?: number;
  nutrition: NutritionPerServing;
  fromCellId?: string;
  replacesCellId?: string;
  createdAt: number;
  updatedAt: number;
}

// A food the user defined by hand — homemade dishes, and the escape hatch when
// a barcode misses both databases.
export interface CustomFood {
  id: string;
  name: string;
  brand?: string;
  servingLabel: string;
  gramsPerServing?: number;
  nutritionPerServing: NutritionPerServing;
  barcode?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PriceOverride {
  name: string;
  pricePerUnit: number;
  unit: string;
}

// User-edited displayName/quantity/unit/category for a grocery item, keyed by
// its normalized `name` (matches GroceryItem.name). Always a full snapshot —
// the edit sheet seeds all four fields before saving, so there's no partial
// override to merge.
export interface ItemOverride {
  name: string;
  displayName: string;
  quantity: number;
  unit: string;
  category: string;
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
