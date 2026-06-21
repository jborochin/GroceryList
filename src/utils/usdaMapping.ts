// Pure helpers that turn a USDA FoodData Central "food detail" payload into the
// per-100g macros + canonical household-measure portions the nutrition estimator
// consumes. Kept dependency-free so both the Node validation harness and the
// Deno `usda-nutrition` edge function can use the same logic (the edge function
// inlines a copy since it can't import from src/).

export interface UsdaPer100g {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MappedFood {
  per100g: UsdaPer100g;
  portions: Record<string, number>; // canonical unit -> grams per 1 unit
}

// USDA nutrient numbers are stable across Foundation / SR Legacy / Branded.
const ENERGY_KCAL = '208';
const PROTEIN = '203';
const CARBS = '205';
const FAT = '204';

interface RawNutrient {
  nutrient?: { number?: string | number; name?: string; unitName?: string };
  nutrientNumber?: string | number;
  unitName?: string;
  amount?: number;
  value?: number;
}

interface RawPortion {
  amount?: number;
  gramWeight?: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { name?: string; abbreviation?: string };
}

export interface RawFoodDetail {
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
}

function nutrientNumber(n: RawNutrient): string {
  return String(n.nutrient?.number ?? n.nutrientNumber ?? '');
}

function nutrientAmount(n: RawNutrient): number {
  if (typeof n.amount === 'number') return n.amount;
  if (typeof n.value === 'number') return n.value;
  return 0;
}

// Foundation/SR Legacy report foodNutrients per 100 g — exactly what we want.
// Energy is messy across datasets: the legacy row is number 208 (kcal), but many
// newer Foundation Foods only carry "Energy (Atwater General/Specific Factors)"
// under different numbers. So prefer 208-kcal, then fall back to ANY kcal "Energy"
// nutrient — otherwise foods like raw cauliflower come back as 0 calories.
export function extractPer100g(food: RawFoodDetail): UsdaPer100g {
  const out: UsdaPer100g = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  let energy208: number | null = null;
  let energyKcalFallback: number | null = null;
  for (const n of food.foodNutrients ?? []) {
    const num = nutrientNumber(n);
    const name = (n.nutrient?.name ?? '').toLowerCase();
    const unit = (n.nutrient?.unitName ?? n.unitName ?? '').toUpperCase();
    const amount = nutrientAmount(n);
    if (num === ENERGY_KCAL && (unit === 'KCAL' || unit === '')) {
      energy208 = amount;
    } else if (name.includes('energy') && unit === 'KCAL') {
      if (energyKcalFallback === null) energyKcalFallback = amount;
    } else if (num === PROTEIN) {
      out.proteinG = amount;
    } else if (num === CARBS) {
      out.carbsG = amount;
    } else if (num === FAT) {
      out.fatG = amount;
    }
  }
  out.calories = energy208 ?? energyKcalFallback ?? 0;
  return out;
}

// Order matters: check the most specific labels first ("fluid ounce" before "oz").
const UNIT_KEYWORDS: Array<[RegExp, string]> = [
  [/fl(?:uid)?\.?\s*oz|fluid ounce/i, 'fl_oz'],
  [/\btbsp\b|tablespoon/i, 'tbsp'],
  [/\btsp\b|teaspoon/i, 'tsp'],
  [/\bcup\b/i, 'cup'],
  [/\bquart\b/i, 'quart'],
  [/\bpint\b/i, 'pint'],
  [/\b(?:medium|large|small|whole|each|piece|fruit|clove|slice|serving|link|fillet|breast|thigh)\b/i, 'each'],
];

export function canonicalPortionUnit(text: string): string | null {
  for (const [re, unit] of UNIT_KEYWORDS) {
    if (re.test(text)) return unit;
  }
  return null;
}

// USDA foodPortions give a gramWeight for `amount` of some household measure.
// Normalize to grams-per-1-unit, keyed by our canonical unit. Keep the first
// match per unit (USDA lists the most representative portion first).
export function extractPortions(food: RawFoodDetail): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of food.foodPortions ?? []) {
    const grams = typeof p.gramWeight === 'number' ? p.gramWeight : 0;
    if (grams <= 0) continue;
    const amount = typeof p.amount === 'number' && p.amount > 0 ? p.amount : 1;
    const label = `${p.measureUnit?.name ?? ''} ${p.modifier ?? p.portionDescription ?? ''}`.trim();
    const unit = canonicalPortionUnit(label);
    if (!unit) continue;
    if (!(unit in out)) out[unit] = grams / amount;
  }
  return out;
}

export function mapFoodDetail(food: RawFoodDetail): MappedFood {
  return { per100g: extractPer100g(food), portions: extractPortions(food) };
}
