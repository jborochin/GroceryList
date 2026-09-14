import type { FoodItem, FoodServing, NutritionPerServing } from '../types/index.ts';

// USDA FoodData Central and Open Food Facts payloads → FoodItem.
//
// This module is imported by BOTH the app's tests and the food-search edge
// function, which is why its own imports carry explicit `.ts` extensions (Deno
// resolves specifiers literally; see the resolve-prices note in CLAUDE.md). The
// alternative — a copy inside the function — is what the older usda-nutrition
// function did, and its header had to say "keep the two in sync". They never
// are. Keep this file dependency-free apart from types.
//
// Both sources publish per 100 g, so that is the basis FoodItem carries and
// servingMath scales from. A "serving" is only ever a named gram weight.

// FDC nutrient numbers. Stable across datasets and far safer than matching on
// nutrient names, which vary ("Energy" vs "Energy (Atwater General Factors)").
const ENERGY_KCAL = '208';
const PROTEIN = '203';
const CARBS = '205';
const FAT = '204';

type Json = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x !== null) as Json[]) : [];
}

// ---------------------------------------------------------------------------
// USDA FoodData Central
// ---------------------------------------------------------------------------

/**
 * Per-100g macros from an FDC food.
 *
 * Handles both payload shapes: search results flatten to
 * `{ nutrientNumber, value, unitName }` while detail responses nest under
 * `{ nutrient: { number, unitName }, amount }`.
 *
 * Energy needs care. Foundation foods often carry TWO energy rows — the
 * Atwater-derived one and nutrient 208 — and some carry energy in kJ only.
 * Prefer 208 in kcal, fall back to any kcal row, and never accept a kJ value as
 * calories (that would report a food as 4.2x its real energy).
 */
export function extractPer100g(food: Json): NutritionPerServing {
  const out: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  let energy208: number | null = null;
  let energyFallback: number | null = null;

  for (const n of asArray(food.foodNutrients)) {
    const nested = (n.nutrient ?? {}) as Json;
    const number = str(nested.number) || str(n.nutrientNumber);
    const name = (str(nested.name) || str(n.nutrientName)).toLowerCase();
    const unit = (str(nested.unitName) || str(n.unitName)).toUpperCase();
    const amount = typeof n.amount === 'number' ? n.amount : num(n.value);

    if (number === ENERGY_KCAL) {
      if (unit === 'KCAL' || unit === '') energy208 = amount;
    } else if (name.includes('energy') && unit === 'KCAL') {
      if (energyFallback === null) energyFallback = amount;
    } else if (number === PROTEIN) out.proteinG = amount;
    else if (number === CARBS) out.carbsG = amount;
    else if (number === FAT) out.fatG = amount;
  }

  out.calories = energy208 ?? energyFallback ?? 0;
  return out;
}

/**
 * Servings for an FDC food.
 *
 * Three shapes, because FDC publishes portions three ways:
 *
 *  - Branded foods carry a label serving on the food itself: `servingSize`
 *    grams plus a household description ("1 container"). Present in SEARCH
 *    results, which is why a scanned product needs no second call.
 *  - Foundation and SR Legacy carry `foodPortions`, but only on the DETAIL
 *    endpoint (`/food/{fdcId}`). Verified against the live API: `foodMeasures`
 *    is present but always `[]` in search responses, for every dataset. That is
 *    why generic foods need a lazy detail fetch before the serving picker can
 *    offer "1 medium banana" rather than grams.
 *  - `foodMeasures` is handled anyway, for the day FDC starts populating it.
 *
 * `servingSizeUnit: 'ml'` is treated as grams. That is a density-1 assumption,
 * correct for water-like drinks and slightly off for oils and syrups — but the
 * alternative is refusing to offer the label serving at all on every beverage,
 * and the user can always switch the picker to grams.
 */
export function extractServings(food: Json): FoodServing[] {
  const out: FoodServing[] = [];

  const servingGrams = num(food.servingSize);
  const servingUnit = str(food.servingSizeUnit).toLowerCase();
  if (servingGrams > 0 && (servingUnit === 'g' || servingUnit === 'ml' || servingUnit === '')) {
    const household = str(food.householdServingFullText);
    out.push({ label: household || `${servingGrams} ${servingUnit || 'g'}`, grams: servingGrams });
  }

  for (const p of asArray(food.foodPortions)) {
    const grams = num(p.gramWeight);
    if (grams <= 0) continue;
    // `amount` is how many of the unit the gram weight describes ("2 tbsp",
    // 30 g), so divide to get one. It is frequently absent or 0, meaning one.
    const amount = num(p.amount) > 0 ? num(p.amount) : 1;
    const measure = str((p.measureUnit as Json | undefined)?.name);
    const modifier = str(p.modifier);
    const described = str(p.portionDescription);
    // 'undetermined' is FDC's placeholder for "the modifier is the unit".
    const unit = measure && measure !== 'undetermined' ? measure : modifier;
    const label = described || (unit ? `${amount} ${unit}`.trim() : '');
    if (!label) continue;
    out.push({ label, grams: grams / amount });
  }

  for (const m of asArray(food.foodMeasures)) {
    const grams = num(m.gramWeight);
    if (grams <= 0) continue;
    const label = str(m.disseminationText) || str(m.modifier);
    if (!label) continue;
    out.push({ label, grams });
  }

  return out;
}

/** One FDC search/detail food → FoodItem, or null when it carries no usable macros. */
export function mapUsdaFood(food: Json): FoodItem | null {
  const fdcId = food.fdcId;
  const name = str(food.description);
  if (!name || (typeof fdcId !== 'number' && typeof fdcId !== 'string')) return null;

  const per100g = extractPer100g(food);
  // A row with neither energy nor protein is a stub (FDC has plenty). Logging it
  // would silently add a 0-calorie food to someone's day.
  if (per100g.calories <= 0 && per100g.proteinG <= 0) return null;

  const brand = str(food.brandName) || str(food.brandOwner);
  const barcode = str(food.gtinUpc);

  return {
    source: 'usda',
    sourceId: String(fdcId),
    name,
    brand: brand || undefined,
    barcode: barcode || undefined,
    per100g,
    servings: extractServings(food),
  };
}

/** An FDC `/foods/search` response → FoodItems, stubs dropped. */
export function mapUsdaSearch(payload: unknown): FoodItem[] {
  const body = (payload ?? {}) as Json;
  const out: FoodItem[] = [];
  for (const food of asArray(body.foods)) {
    const item = mapUsdaFood(food);
    if (item) out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

/**
 * An OFF `/api/v2/product/<barcode>` response → FoodItem.
 *
 * OFF is crowd-sourced, so a product page can exist with no nutrition at all —
 * `status` is 1 and `product` is present, but `nutriments` is empty. That must
 * read as a miss, not as a zero-calorie food, so the same energy/protein floor
 * as the USDA path applies.
 */
export function mapOffProduct(payload: unknown): FoodItem | null {
  const body = (payload ?? {}) as Json;
  const product = (body.product ?? {}) as Json;
  const code = str(product.code) || str(body.code);
  const name = str(product.product_name) || str(product.generic_name);
  if (!name) return null;

  const nutriments = (product.nutriments ?? {}) as Json;
  const per100g: NutritionPerServing = {
    // OFF publishes energy twice; take the kcal key and never energy_100g,
    // which is kJ for most European products.
    calories: num(nutriments['energy-kcal_100g']),
    proteinG: num(nutriments.proteins_100g),
    carbsG: num(nutriments.carbohydrates_100g),
    fatG: num(nutriments.fat_100g),
  };
  if (per100g.calories <= 0 && per100g.proteinG <= 0) return null;

  const servings: FoodServing[] = [];
  const servingGrams = num(product.serving_quantity);
  if (servingGrams > 0) {
    servings.push({ label: str(product.serving_size) || 'serving', grams: servingGrams });
  }

  const brand = str(product.brands).split(',')[0].trim();

  return {
    source: 'off',
    sourceId: code || name,
    name,
    brand: brand || undefined,
    barcode: code || undefined,
    per100g,
    servings,
  };
}

// ---------------------------------------------------------------------------
// Ingest guard (client side)
// ---------------------------------------------------------------------------

/**
 * Validate FoodItems coming back from the edge function before they reach the
 * UI. The function is ours, but the databases behind it are not, and a NaN in
 * `per100g` would propagate straight into a stored diary entry.
 */
export function ingestFoodItems(payload: unknown): FoodItem[] {
  if (!Array.isArray(payload)) return [];
  const out: FoodItem[] = [];
  for (const raw of payload) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Json;
    const name = str(item.name);
    const source = str(item.source);
    if (!name) continue;
    if (source !== 'usda' && source !== 'off' && source !== 'custom') continue;

    const p = (item.per100g ?? {}) as Json;
    // Negative macros are data errors, not deficits; clamp them away.
    const per100g: NutritionPerServing = {
      calories: Math.max(0, num(p.calories)),
      proteinG: Math.max(0, num(p.proteinG)),
      carbsG: Math.max(0, num(p.carbsG)),
      fatG: Math.max(0, num(p.fatG)),
    };
    if (per100g.calories <= 0 && per100g.proteinG <= 0) continue;
    // Physically impossible per 100 g: nothing is denser than pure fat (~900 kcal),
    // and no macro can exceed the whole 100 g. Crowd-sourced OFF rows do this (a
    // per-package value typed into the per-100g field) and would otherwise log a
    // 5,000-calorie yogurt. Dropped rather than clamped: the rest of the row is
    // just as suspect.
    if (
      per100g.calories > 950 ||
      per100g.proteinG > 100 ||
      per100g.carbsG > 100 ||
      per100g.fatG > 100 ||
      per100g.proteinG + per100g.carbsG + per100g.fatG > 105
    ) {
      continue;
    }

    const servings: FoodServing[] = [];
    for (const s of asArray(item.servings)) {
      const label = str(s.label);
      const grams = num(s.grams);
      if (label && grams > 0) servings.push({ label, grams });
    }

    out.push({
      source,
      sourceId: str(item.sourceId) || name,
      name,
      brand: str(item.brand) || undefined,
      barcode: str(item.barcode) || undefined,
      per100g,
      servings,
    });
  }
  return out;
}
