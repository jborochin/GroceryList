import { roundToPurchasable } from '../utils/purchaseRounding';
import { GroceryItem, GroceryEntry } from '../types';

function item(name: string, entries: GroceryEntry[]): GroceryItem {
  return { name, displayName: name, category: 'Other', entries, hasPriceGap: false };
}
const one = (name: string, qty: number, unit: string) => item(name, [{ quantity: qty, unit }]);

function only(items: GroceryItem[]) {
  expect(items).toHaveLength(1);
  return items[0].entries;
}

describe('roundToPurchasable', () => {
  it('rounds a fractional count up to a whole unit', () => {
    expect(only(roundToPurchasable([one('avocado', 0.5, 'each')]))).toEqual([
      { quantity: 1, unit: 'each' },
    ]);
    expect(only(roundToPurchasable([one('lemon', 0.25, 'each')]))).toEqual([
      { quantity: 1, unit: 'each' },
    ]);
  });

  it('does not over-round an already-whole count', () => {
    expect(only(roundToPurchasable([one('avocado', 2, 'each')]))).toEqual([
      { quantity: 2, unit: 'each' },
    ]);
  });

  it('rounds a cup of broccoli up to one head', () => {
    expect(only(roundToPurchasable([one('broccoli', 1, 'cup')]))).toEqual([
      { quantity: 1, unit: 'head' },
    ]);
  });

  it('rounds cloves of garlic up to one head', () => {
    expect(only(roundToPurchasable([one('garlic', 2, 'clove')]))).toEqual([
      { quantity: 1, unit: 'head' },
    ]);
  });

  it('rounds ounces of cheese up to one block', () => {
    expect(only(roundToPurchasable([one('cheddar cheese', 3, 'oz')]))).toEqual([
      { quantity: 1, unit: 'block' },
    ]);
  });

  it('leaves weight-sold items continuous (chicken stays lb, no whole-pound inflation)', () => {
    const out = roundToPurchasable([one('chicken breast', 0.375, 'lb')]);
    expect(out[0].entries).toEqual([{ quantity: 0.375, unit: 'lb' }]);
  });

  it('passes through items with no profile unchanged', () => {
    const out = roundToPurchasable([one('unobtainium-7', 1, 'each')]);
    expect(out[0].entries).toEqual([{ quantity: 1, unit: 'each' }]);
  });

  it('merges multiple entries of the same item into one purchase', () => {
    const out = roundToPurchasable([
      item('flour', [
        { quantity: 1, unit: 'cup' },
        { quantity: 50, unit: 'g' },
      ]),
    ]);
    expect(only(out)).toEqual([{ quantity: 1, unit: 'bag' }]);
  });

  it('preserves item identity fields', () => {
    const src = one('broccoli', 1, 'cup');
    const out = roundToPurchasable([src]);
    expect(out[0].name).toBe('broccoli');
    expect(out[0].category).toBe('Other');
  });
});
