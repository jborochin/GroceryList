import { coreFoodName, estimateNutrition, FoodProvider } from '../utils/nutritionEstimator';
import { parseIngredient } from '../utils/ingredientParser';
import { normalizeName } from '../utils/normalizeName';
import type { Ingredient } from '../types';

// A fake USDA provider keyed by normalized name. per100g + optional portions
// (grams per 1 unit, keyed by canonical unit).
const FOODS: Record<string, { per100g: any; portions?: Record<string, number> }> = {
  flour: { per100g: { calories: 364, proteinG: 10, carbsG: 76, fatG: 1 }, portions: { cup: 120 } },
  sugar: { per100g: { calories: 387, proteinG: 0, carbsG: 100, fatG: 0 } }, // density from file (0.85 g/ml)
  broth: { per100g: { calories: 7, proteinG: 1, carbsG: 0, fatG: 0 } }, // absent from densities → default 1.0 g/ml
  'skirt steak': { per100g: { calories: 200, proteinG: 27, carbsG: 0, fatG: 10 } },
  avocado: { per100g: { calories: 160, proteinG: 2, carbsG: 9, fatG: 15 }, portions: { each: 150 } },
  'olive oil': { per100g: { calories: 884, proteinG: 0, carbsG: 0, fatG: 100 } },
};

const provider: FoodProvider = (norm) => FOODS[norm] ?? null;

function ing(raw: string): Ingredient {
  return parseIngredient(raw);
}

describe('coreFoodName', () => {
  it('drops prep clauses after the first comma', () => {
    expect(coreFoodName('black beans, drained, rinsed')).toBe('black beans');
    expect(coreFoodName('skirt steak, cut into 1/2" slices')).toBe('skirt steak');
  });

  it('strips prep adjectives but keeps cooking-state words', () => {
    expect(coreFoodName('freshly ground black pepper')).toBe('black pepper');
    expect(coreFoodName('finely chopped fresh cilantro')).toBe('fresh cilantro');
    expect(coreFoodName('cooked brown rice')).toBe('cooked brown rice'); // state preserved
  });

  it('feeds a clean join key once normalized', () => {
    expect(normalizeName(coreFoodName('black beans, drained, rinsed'))).toBe('black bean');
  });
});

describe('estimateNutrition', () => {
  it('converts weight units to grams directly', () => {
    // 1 lb skirt steak = 453.592 g → factor 4.53592 × per100g
    const est = estimateNutrition([ing('1 lb skirt steak')], 1, provider);
    expect(est.perRecipe.calories).toBeCloseTo(200 * 4.53592, 0);
    expect(est.perRecipe.proteinG).toBeCloseTo(27 * 4.53592, 0);
    expect(est.itemsMatched).toBe(1);
    expect(est.itemsSkipped).toBe(0);
  });

  it('uses a USDA portion when the ingredient unit matches', () => {
    // 2 cups flour, portion cup=120g → 240 g → 2.4 × per100g
    const est = estimateNutrition([ing('2 cups flour')], 1, provider);
    expect(est.perRecipe.calories).toBeCloseTo(364 * 2.4, 0);
  });

  it('uses the density file (g/ml) for volume units when no portion exists', () => {
    // 1 cup sugar, no portion → cup→ml (236.59) × file density 0.85
    const est = estimateNutrition([ing('1 cup sugar')], 1, provider);
    expect(est.perRecipe.calories).toBeCloseTo(387 * 2.3659 * 0.85, 0);
  });

  it('falls back to default 1.0 g/ml for volume foods absent from the density file', () => {
    // 1 cup broth, not in densities → cup→ml (236.59) × default 1.0
    const est = estimateNutrition([ing('1 cup broth')], 1, provider);
    expect(est.perRecipe.calories).toBeCloseTo(7 * 2.3659, 0);
  });

  it('uses an each portion for count units', () => {
    // 1 avocado, portion each=150g → 1.5 × per100g
    const est = estimateNutrition([ing('1 avocado')], 1, provider);
    expect(est.perRecipe.fatG).toBeCloseTo(15 * 1.5, 1);
  });

  it('divides totals by servings for perServing', () => {
    const est = estimateNutrition([ing('1 lb skirt steak')], 4, provider);
    expect(est.perServing.calories).toBeCloseTo((200 * 4.53592) / 4, 0);
  });

  it('skips ingredients with no explicit amount (fixes default-portion inflation)', () => {
    // "Sour cream, for serving" + "Kosher salt" — no quantity → skipped, not guessed
    const est = estimateNutrition(
      [ing('Sour cream, for serving'), ing('Kosher salt'), ing('1 lb skirt steak')],
      1,
      provider,
    );
    expect(est.itemsSkipped).toBe(2);
    expect(est.itemsMatched).toBe(1);
    expect(est.perRecipe.calories).toBeCloseTo(200 * 4.53592, 0);
  });

  it('skips "to taste" / "for garnish" items even when a quantity-like token exists elsewhere', () => {
    const est = estimateNutrition([ing('Salt, to taste'), ing('Cilantro, for garnish')], 1, provider);
    expect(est.itemsMatched).toBe(0);
    expect(est.itemsSkipped).toBe(2);
  });

  it('skips ingredients with no provider match', () => {
    const est = estimateNutrition([ing('2 cups unicorn dust')], 1, provider);
    expect(est.itemsMatched).toBe(0);
    expect(est.itemsSkipped).toBe(1);
    expect(est.perRecipe.calories).toBe(0);
  });

  it('skips count items with no portion and no known per-each weight', () => {
    // olive oil keyed but queried as a count with no each-weight → can't convert
    const est = estimateNutrition([ing('3 olive oil')], 1, provider);
    expect(est.itemsMatched).toBe(0);
    expect(est.itemsSkipped).toBe(1);
  });
});
