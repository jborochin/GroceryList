import { buildGroceryList } from '../utils/groceryPipeline';
import { Ingredient, Recipe } from '../types';

function recipe(id: string, servings: number, ingredients: Ingredient[]): Recipe {
  return { id, title: id, servings, ingredients, createdAt: 0, updatedAt: 0 };
}

const base = {
  plan: [{ recipeId: 'a', desiredServings: 2 }],
  groceryRecipes: [],
  recipes: [
    recipe('a', 2, [
      { name: 'broccoli', quantity: 1, unit: 'cup' },
      { name: 'tofu', quantity: 8, unit: 'oz' },
      { name: 'olive oil', quantity: 1, unit: 'tbsp' },
    ]),
  ],
  pantry: [],
  manualItems: [],
  itemOverrides: {},
  priceOverrides: {},
  dismissedNames: [],
};

describe('buildGroceryList', () => {
  it('runs the full List-tab pipeline: rounding, manual items, overrides, pricing', () => {
    const out = buildGroceryList({
      ...base,
      manualItems: [{ id: 'm1', name: 'paper towels', quantity: 2, unit: 'roll' }],
      itemOverrides: {
        tofu: { name: 'tofu', displayName: 'Firm tofu', quantity: 2, unit: 'lb', category: 'Protein' },
      },
    });
    const broccoli = out.items.find((i) => i.name === 'broccoli')!;
    // roundToPurchasable rewrote the cup into a whole head.
    expect(broccoli.entries[0].unit).toBe('head');
    expect(out.items.some((i) => i.name === 'paper towel')).toBe(true);
    const tofu = out.items.find((i) => i.name === 'tofu')!;
    expect(tofu.displayName).toBe('Firm tofu');
    expect(tofu.entries).toEqual([expect.objectContaining({ quantity: 2, unit: 'lb' })]);
    expect(tofu.estimatedPrice).toBeCloseTo(7.98, 1);
  });

  it('drops dismissed names from items/total but keeps them in `all` for pruning', () => {
    const out = buildGroceryList({ ...base, dismissedNames: ['tofu'] });
    expect(out.items.some((i) => i.name === 'tofu')).toBe(false);
    expect(out.all.some((i) => i.name === 'tofu')).toBe(true);
    const full = buildGroceryList(base);
    expect(out.total).toBeLessThan(full.total);
    expect(out.total).toBeCloseTo(
      full.total - full.items.find((i) => i.name === 'tofu')!.estimatedPrice!,
      5
    );
  });

  it('reports visible names whole and sorted, never split into words', () => {
    const out = buildGroceryList(base);
    expect(out.names).toEqual([...out.names].sort());
    expect(out.names).toContain('olive oil');
    expect(out.names).not.toContain('olive');
  });

  it('counts an item with a partial price gap as unestimated', () => {
    const out = buildGroceryList({
      ...base,
      recipes: [
        recipe('a', 2, [
          { name: 'tofu', quantity: 1, unit: 'lb' },
          { name: 'tofu', quantity: 1, unit: 'sprig' },
        ]),
      ],
    });
    const tofu = out.items.find((i) => i.name === 'tofu')!;
    expect(tofu.estimatedPrice).toBeDefined();
    expect(tofu.hasPriceGap).toBe(true);
    expect(out.unestimatedCount).toBe(1);
  });
});
