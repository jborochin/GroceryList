import { aggregate } from '../utils/ingredientAggregator';
import { Recipe } from '../types';

function recipe(id: string, servings: number, ingredients: Array<{ name: string; quantity: number; unit: string }>): Recipe {
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
});
