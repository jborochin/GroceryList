import { aggregate } from '../utils/ingredientAggregator';
import { convert } from '../utils/unitConversion';
import { GroceryEntry, Ingredient, Recipe } from '../types';

/** A merged entry's total, read back in a chosen unit so prettyUnit's choice of
 *  display unit isn't baked into the assertion. Approximate: the entry has
 *  already been rounded for display, so compare with a tolerance. */
function totalIn(entry: GroceryEntry, unit: string): number {
  const converted = convert(entry.quantity, entry.unit, unit);
  if (converted === null) throw new Error(`cannot express ${entry.unit} as ${unit}`);
  return converted;
}

function recipe(id: string, servings: number, ingredients: Ingredient[]): Recipe {
  return {
    id,
    title: id,
    servings,
    ingredients: ingredients.map((i) => ({ ...i })),
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('ingredientAggregator', () => {
  it('merges same ingredient across recipes in same unit', () => {
    const recipes = [
      recipe('a', 2, [{ name: 'olive oil', quantity: 1, unit: 'tbsp' }]),
      recipe('b', 2, [{ name: 'olive oil', quantity: 2, unit: 'tbsp' }]),
    ];
    const plan = [
      { recipeId: 'a', desiredServings: 2 },
      { recipeId: 'b', desiredServings: 2 },
    ];
    const out = aggregate(plan, recipes);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('olive oil');
    expect(out[0].entries).toHaveLength(1);
    expect(out[0].entries[0].unit).toBe('tbsp');
    expect(out[0].entries[0].quantity).toBeCloseTo(3, 5);
  });

  it('scales servings proportionally', () => {
    const recipes = [recipe('a', 2, [{ name: 'flour', quantity: 1, unit: 'cup' }])];
    const out = aggregate([{ recipeId: 'a', desiredServings: 4 }], recipes);
    expect(out[0].entries[0].quantity).toBeCloseTo(2, 5);
  });

  it('normalizes plural name when grouping', () => {
    const recipes = [
      recipe('a', 1, [{ name: 'tomato', quantity: 1, unit: 'each' }]),
      recipe('b', 1, [{ name: 'tomatoes', quantity: 2, unit: 'each' }]),
    ];
    const out = aggregate(
      [
        { recipeId: 'a', desiredServings: 1 },
        { recipeId: 'b', desiredServings: 1 },
      ],
      recipes
    );
    expect(out).toHaveLength(1);
    expect(out[0].entries[0].quantity).toBeCloseTo(3, 5);
  });

  it('lists separately when units are incompatible', () => {
    const recipes = [
      recipe('a', 1, [{ name: 'flour', quantity: 1, unit: 'cup' }]),
      recipe('b', 1, [{ name: 'flour', quantity: 100, unit: 'g' }]),
    ];
    const out = aggregate(
      [
        { recipeId: 'a', desiredServings: 1 },
        { recipeId: 'b', desiredServings: 1 },
      ],
      recipes
    );
    expect(out).toHaveLength(1);
    expect(out[0].entries).toHaveLength(2);
  });

  it('strips prep descriptors so differently-cut ingredients merge into one purchasable item', () => {
    const recipes = [
      recipe('a', 1, [{ name: 'diced red bell pepper', quantity: 1, unit: 'each' }]),
      recipe('b', 1, [{ name: 'sliced red bell pepper', quantity: 2, unit: 'each' }]),
    ];
    const out = aggregate(
      [
        { recipeId: 'a', desiredServings: 1 },
        { recipeId: 'b', desiredServings: 1 },
      ],
      recipes
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('red bell pepper');
    expect(out[0].displayName).toBe('red bell pepper');
    expect(out[0].entries[0].quantity).toBeCloseTo(3, 5);
  });

  // The grocery list feeds aggregate() the meal plan and the grocery-only
  // recipes (useGroceryRecipeStore) concatenated. A recipe sitting in both must
  // contribute twice — a double batch — rather than being deduped by recipeId.
  it('sums duplicate entries for the same recipe (plan + grocery-only add)', () => {
    const recipes = [recipe('a', 2, [{ name: 'flour', quantity: 1, unit: 'cup' }])];
    const out = aggregate(
      [
        { recipeId: 'a', desiredServings: 2 }, // planned: 1 cup
        { recipeId: 'a', desiredServings: 4 }, // added straight to the list: 2 cups
      ],
      recipes
    );
    expect(out).toHaveLength(1);
    expect(out[0].entries).toHaveLength(1);
    expect(out[0].entries[0].unit).toBe('cup');
    expect(out[0].entries[0].quantity).toBeCloseTo(3, 5);
  });

  it('converts within family when merging', () => {
    const recipes = [
      recipe('a', 1, [{ name: 'milk', quantity: 1, unit: 'cup' }]),
      recipe('b', 1, [{ name: 'milk', quantity: 4, unit: 'tbsp' }]),
    ];
    const out = aggregate(
      [
        { recipeId: 'a', desiredServings: 1 },
        { recipeId: 'b', desiredServings: 1 },
      ],
      recipes
    );
    expect(out[0].entries).toHaveLength(1);
    // 1 cup + 4 tbsp = 16 tbsp + 4 tbsp = 20 tbsp = 1.25 cups
    expect(out[0].entries[0].quantity).toBeCloseTo(1.25, 2);
    expect(out[0].entries[0].unit).toBe('cup');
  });

  it('merges an ingredient repeated across sub-recipe sections of ONE recipe', () => {
    // Meal-prep captions season two components from the same jar: the chipotle
    // reel lists garlic powder under both "Chipotle Chicken Marinade" and
    // "Crispy Seasoned Potatoes". The recipe keeps that split visible; the
    // grocery list must not — you buy one jar.
    //
    // This holds because aggregate() reads name/quantity/unit and never
    // `section`. The test exists so that stays true: routing sections into the
    // grouping key would silently double the list.
    const recipes = [
      recipe('chipotle', 6, [
        { name: 'garlic powder', quantity: 3, unit: 'tsp', section: 'Chipotle Chicken Marinade' },
        { name: 'garlic powder', quantity: 2.5, unit: 'tsp', section: 'Crispy Seasoned Potatoes' },
      ]),
    ];
    const out = aggregate([{ recipeId: 'chipotle', desiredServings: 6 }], recipes);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('garlic powder');
    expect(out[0].entries).toHaveLength(1);
    // Compared back in tsp rather than against a literal, because prettyUnit
    // promotes the sum to tbsp — which is a display choice, not the total.
    expect(totalIn(out[0].entries[0], 'tsp')).toBeCloseTo(5.5, 1);
  });

  it('scales a sectioned ingredient like any other', () => {
    const recipes = [
      recipe('chipotle', 6, [
        { name: 'chipotle paste', quantity: 100, unit: 'g', section: 'Chipotle Chicken Marinade' },
        { name: 'chipotle paste', quantity: 70, unit: 'g', section: 'Creamy Chipotle Sauce' },
      ]),
    ];
    // Half the servings, so (100 + 70) g halves to 85 g.
    const out = aggregate([{ recipeId: 'chipotle', desiredServings: 3 }], recipes);
    expect(out).toHaveLength(1);
    expect(totalIn(out[0].entries[0], 'g')).toBeCloseTo(85, 0);
  });
});

describe('aggregate — non-finite and zero servings', () => {
  it('skips a plan entry whose scaling ratio is not a positive finite number', () => {
    const recipes = [
      recipe('nan', NaN, [{ name: 'flour', quantity: 1, unit: 'cup' }]),
      recipe('ok', 2, [{ name: 'sugar', quantity: 1, unit: 'cup' }]),
    ];
    const out = aggregate(
      [
        { recipeId: 'nan', desiredServings: 2 },
        { recipeId: 'ok', desiredServings: 0 },
        { recipeId: 'ok', desiredServings: 2 },
      ],
      recipes
    );
    expect(out.map((i) => i.name)).toEqual(['sugar']);
    expect(out[0].entries[0].quantity).toBeCloseTo(1, 5);
    expect(Number.isFinite(out[0].entries[0].quantity)).toBe(true);
  });
});

describe('mergeGroup — unknown units', () => {
  it('sums entries that share the same unknown unit label', () => {
    const { mergeGroup } = require('../utils/ingredientAggregator');
    const out = mergeGroup('mint', 'mint', [
      { name: 'mint', quantity: 2, unit: 'sprigs' },
      { name: 'mint', quantity: 3, unit: 'sprigs' },
      { name: 'mint', quantity: 1, unit: 'handfuls' },
    ]);
    expect(out.entries).toEqual([
      { quantity: 5, unit: 'sprigs' },
      { quantity: 1, unit: 'handfuls' },
    ]);
  });
});
