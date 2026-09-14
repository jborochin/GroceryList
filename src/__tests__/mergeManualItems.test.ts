import { mergeManualItems } from '../utils/mergeManualItems';
import { GroceryItem, ManualItem } from '../types';

function manual(id: string, name: string, quantity: number, unit: string): ManualItem {
  return { id, name, quantity, unit };
}

function item(name: string, displayName: string, entries: Array<{ quantity: number; unit: string }>, category = 'Other'): GroceryItem {
  return { name, displayName, category, entries, hasPriceGap: false };
}

describe('mergeManualItems', () => {
  it('returns the input untouched when there are no manual items', () => {
    const items = [item('flour', 'flour', [{ quantity: 1, unit: 'cup' }])];
    expect(mergeManualItems(items, [])).toBe(items);
  });

  it('adds a manual-only item as its own categorized row', () => {
    const out = mergeManualItems([], [manual('1', 'paper towels', 2, 'roll')]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('paper towel');
    expect(out[0].entries).toEqual([{ quantity: 2, unit: 'roll' }]);
    expect(out[0].category).toBeTruthy();
  });

  it('merges a manual item into a recipe item of the same name and unit family', () => {
    const items = [item('egg', 'eggs', [{ quantity: 2, unit: 'each' }], 'Protein')];
    const out = mergeManualItems(items, [manual('1', 'eggs', 3, 'each')]);
    expect(out).toHaveLength(1);
    expect(out[0].entries).toHaveLength(1);
    expect(out[0].entries[0].unit).toBe('each');
    expect(out[0].entries[0].quantity).toBeCloseTo(5, 5);
  });

  it('canonicalizes plural units so "lbs" merges with "lb"', () => {
    const items = [item('beef', 'beef', [{ quantity: 1, unit: 'lb' }], 'Protein')];
    const out = mergeManualItems(items, [manual('1', 'beef', 1, 'lbs')]);
    expect(out).toHaveLength(1);
    expect(out[0].entries).toHaveLength(1);
    expect(out[0].entries[0].unit).toBe('lb');
    expect(out[0].entries[0].quantity).toBeCloseTo(2, 5);
  });

  it('strips a prep descriptor so a manual item merges with the matching recipe item', () => {
    const items = [item('onion', 'onion', [{ quantity: 1, unit: 'each' }], 'Produce')];
    const out = mergeManualItems(items, [manual('1', 'chopped onion', 2, 'each')]);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe('onion');
    expect(out[0].entries).toEqual([{ quantity: 3, unit: 'each' }]);
  });

  it('ignores manual items with a blank name', () => {
    const out = mergeManualItems([], [manual('1', '   ', 1, 'each')]);
    expect(out).toHaveLength(0);
  });
});

describe('manualItemKey', () => {
  it('yields the same key mergeManualItems groups the item under', () => {
    const { manualItemKey } = require('../utils/mergeManualItems');
    const out = mergeManualItems([], [manual('1', 'Paper Towels', 2, 'roll')]);
    expect(manualItemKey('Paper Towels')).toBe(out[0].name);
  });
});
