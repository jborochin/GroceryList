import { Ingredient, NutritionPerServing } from '../types';
import { convert, getFamily } from './unitConversion';
import { normalizeName } from './normalizeName';
import densitiesJson from '../data/ingredientDensities.json';

// Per-food nutrition as returned by the USDA-backed provider. `per100g` is the
// macro content of 100 g of the food; `portions` maps a canonical unit
// (cup/tbsp/tsp/each/...) to the gram weight of ONE such unit, when USDA exposes
// a matching household measure.
export interface FoodNutrition {
  per100g: NutritionPerServing;
  portions?: Record<string, number>;
}

export type FoodProvider = (normalizedName: string) => FoodNutrition | null;

export interface NutritionEstimate {
  perRecipe: NutritionPerServing;
  perServing: NutritionPerServing;
  itemsMatched: number;
  itemsSkipped: number;
}

interface DensityEntry {
  gPerMl?: number;
  gramsEach?: number;
}

const DENSITIES = densitiesJson as Record<string, DensityEntry>;
const DEFAULT_G_PER_ML = 1.0;

// Ingredients listed without a real amount ("Kosher salt", "Sour cream, for
// serving", "Salt, to taste") must be skipped, not guessed — inventing a default
// portion is exactly what made the old CalorieNinjas estimate run high (e.g. a
// garnish of sour cream adding ~20 g fat). Skip when the line carries no numeric
// quantity, or is explicitly a serving/garnish/optional note.
const UNICODE_FRACTION = /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/;
const SKIP_NOTE =
  /\b(?:to taste|for serving|for garnish|for topping|as needed|optional|for dusting|for drizzling|for frying|for greasing|for brushing|garnish)\b/i;

function hasExplicitAmount(raw: string): boolean {
  return /\d/.test(raw) || UNICODE_FRACTION.test(raw);
}

// Prep words that don't change per-100g nutrition — safe to drop before lookup.
// NOTE: cooking-state words (cooked/raw/fresh/frozen/dried) are intentionally NOT
// here — they change calories per gram, so "cooked brown rice" must stay distinct
// from raw rice.
const PREP_WORDS =
  /\b(?:divided|softened|melted|drained|rinsed|chopped|diced|sliced|minced|mashed|crushed|smashed|peeled|halved|quartered|cubed|shredded|grated|trimmed|packed|optional|thinly|finely|roughly|freshly|ground|beaten|toasted|warmed|thawed|room temperature)\b/g;

/**
 * Reduce a recipe ingredient name to its core food for nutrition lookup: drop any
 * clause after the first comma ("black beans, drained, rinsed" → "black beans")
 * and strip prep adjectives ("freshly ground black pepper" → "black pepper").
 * Kept separate from normalizeName (load-bearing for grouping/pricing) so those
 * call sites are unaffected.
 */
export function coreFoodName(name: string): string {
  let n = name.toLowerCase().split(',')[0];
  n = n.replace(PREP_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return n || name;
}

function shouldSkip(ing: Ingredient): boolean {
  const raw = ing.raw ?? ing.name;
  if (SKIP_NOTE.test(raw)) return true;
  if (!hasExplicitAmount(raw)) return true;
  return false;
}

function gPerMl(norm: string): number {
  const d = DENSITIES[norm];
  return d && typeof d.gPerMl === 'number' ? d.gPerMl : DEFAULT_G_PER_ML;
}

function gramsEach(norm: string): number | null {
  const d = DENSITIES[norm];
  return d && typeof d.gramsEach === 'number' ? d.gramsEach : null;
}

// Resolve one parsed ingredient to a gram weight, or null when it can't be
// estimated (unknown count item with no per-each weight, incompatible unit).
function ingredientGrams(ing: Ingredient, norm: string, food: FoodNutrition): number | null {
  const unit = ing.unit;
  const qty = ing.quantity;
  const family = getFamily(unit);

  if (family === 'weight') {
    return convert(qty, unit, 'g'); // always defined within the weight family
  }

  if (family === 'volume') {
    // USDA cup/tbsp/tsp portions are reliable; prefer them, then density.
    const portion = food.portions?.[unit];
    if (typeof portion === 'number') return qty * portion;
    const ml = convert(qty, unit, 'ml');
    if (ml == null) return null;
    return ml * gPerMl(norm);
  }

  // Count units (each/slice/clove/...) or unknown labels: prefer the curated
  // per-item weight (USDA's "each" portions are often an ambiguous slice/oz, not
  // a whole item), then a USDA portion, else give up rather than fabricate one.
  const each = gramsEach(norm);
  if (each != null) return qty * each;
  const portion = food.portions?.[unit];
  if (typeof portion === 'number') return qty * portion;
  return null;
}

const ZERO: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Estimate recipe nutrition by summing per-ingredient USDA data.
 *
 * Pure and provider-injected so it's testable without network access: pass a
 * `lookup` that maps a normalized ingredient name to its per-100g macros and
 * (optionally) household-measure portions. Returns both the whole-recipe total
 * and the per-serving figure (total ÷ servings).
 */
export function estimateNutrition(
  ingredients: Ingredient[],
  servings: number,
  lookup: FoodProvider,
): NutritionEstimate {
  const total: NutritionPerServing = { ...ZERO };
  let itemsMatched = 0;
  let itemsSkipped = 0;

  for (const ing of ingredients) {
    if (!ing.name || shouldSkip(ing)) {
      itemsSkipped += 1;
      continue;
    }
    const norm = normalizeName(coreFoodName(ing.name));
    const food = lookup(norm);
    if (!food) {
      itemsSkipped += 1;
      continue;
    }
    const grams = ingredientGrams(ing, norm, food);
    if (grams == null || !Number.isFinite(grams) || grams <= 0) {
      itemsSkipped += 1;
      continue;
    }
    const factor = grams / 100;
    total.calories += food.per100g.calories * factor;
    total.proteinG += food.per100g.proteinG * factor;
    total.carbsG += food.per100g.carbsG * factor;
    total.fatG += food.per100g.fatG * factor;
    itemsMatched += 1;
  }

  const s = Math.max(1, Math.round(servings));
  const perRecipe: NutritionPerServing = {
    calories: Math.round(total.calories),
    proteinG: round1(total.proteinG),
    carbsG: round1(total.carbsG),
    fatG: round1(total.fatG),
  };
  const perServing: NutritionPerServing = {
    calories: Math.round(total.calories / s),
    proteinG: round1(total.proteinG / s),
    carbsG: round1(total.carbsG / s),
    fatG: round1(total.fatG / s),
  };
  return { perRecipe, perServing, itemsMatched, itemsSkipped };
}
