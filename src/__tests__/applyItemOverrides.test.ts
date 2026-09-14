import { applyItemOverrides } from '../utils/applyItemOverrides';
import { GroceryItem, ItemOverride } from '../types';

function item(
  name: string,
  displayName: string,
  entries: Array<{ quantity: number; unit: string }>,
  category = 'Other',
  extra: Partial<GroceryItem> = {}
): GroceryItem {
  return { name, displayName, category, entries, hasPriceGap: false, ...extra };
}

function override(
  name: string,
  displayName: string,
  quantity: number,
  unit: string,
  category: string
): ItemOverride {
  return { name, displayName, quantity, unit, category };
}

describe('applyItemOverrides', () => {
  it('returns the input untouched when there are no overrides', () => {
    const items = [item('flour', 'flour', [{ quantity: 1, unit: 'cup' }])];
    expect(applyItemOverrides(items, {})).toBe(items);
  });

  it('applies an override: rewrites displayName/category/entries but not the name join key', () => {
    const items = [item('egg', 'eggs', [{ quantity: 2, unit: 'each' }], 'Protein')];
    const overrides = { egg: override('egg', 'Free-range eggs', 1, 'dozen', 'Pantry') };
    const out = applyItemOverrides(items, overrides);
    expect(out[0].name).toBe('egg');
    expect(out[0].displayName).toBe('Free-range eggs');
    expect(out[0].category).toBe('Pantry');
    expect(out[0].entries).toEqual([{ quantity: 1, unit: 'dozen' }]);
  });

  it('passes through an item with no matching override, even when other overrides exist', () => {
    const items = [
      item('egg', 'eggs', [{ quantity: 2, unit: 'each' }], 'Protein'),
      item('flour', 'flour', [{ quantity: 1, unit: 'cup' }], 'Pantry'),
    ];
    const overrides = { egg: override('egg', 'Eggs', 2, 'each', 'Protein') };
    const out = applyItemOverrides(items, overrides);
    expect(out[1]).toEqual(items[1]);
  });

  it('collapses multiple entries into the single overridden entry', () => {
    const items = [
      item('flour', 'flour', [
        { quantity: 1, unit: 'cup' },
        { quantity: 100, unit: 'g' },
      ]),
    ];
    const overrides = { flour: override('flour', 'flour', 3, 'cup', 'Pantry') };
    const out = applyItemOverrides(items, overrides);
    expect(out[0].entries).toEqual([{ quantity: 3, unit: 'cup' }]);
  });

  it('leaves hasPriceGap and estimatedPrice untouched', () => {
    const items = [
      item('egg', 'eggs', [{ quantity: 2, unit: 'each' }], 'Protein', {
        hasPriceGap: true,
        estimatedPrice: 5,
      }),
    ];
    const overrides = { egg: override('egg', 'Eggs', 1, 'dozen', 'Protein') };
    const out = applyItemOverrides(items, overrides);
    expect(out[0].hasPriceGap).toBe(true);
    expect(out[0].estimatedPrice).toBe(5);
  });
});

describe('applyItemOverrides — prototype-safe', () => {
  it('does not treat an item named like an Object.prototype member as overridden', () => {
    const items = [item('constructor', 'constructor', [{ quantity: 1, unit: 'each' }])];
    const out = applyItemOverrides(items, { egg: override('egg', 'Eggs', 2, 'each', 'Protein') });
    expect(out[0]).toEqual(items[0]);
  });
});
