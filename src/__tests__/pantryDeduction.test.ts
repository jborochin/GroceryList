import { applyPantry } from '../utils/pantryDeduction';
import { GroceryItem, PantryItem } from '../types';

function item(name: string, qty: number, unit: string): GroceryItem {
  return {
    name,
    displayName: name,
    category: 'Other',
    entries: [{ quantity: qty, unit }],
    hasPriceGap: false,
  };
}

describe('pantryDeduction', () => {
  it('removes item when pantry has no quantity', () => {
    const items = [item('salt', 1, 'tsp')];
    const pantry: PantryItem[] = [{ id: '1', name: 'salt' }];
    expect(applyPantry(items, pantry)).toHaveLength(0);
  });

  it('subtracts quantity when units match', () => {
    const items = [item('egg', 10, 'each')];
    const pantry: PantryItem[] = [{ id: '1', name: 'eggs', quantity: 6, unit: 'each' }];
    const out = applyPantry(items, pantry);
    expect(out).toHaveLength(1);
    expect(out[0].entries[0].quantity).toBeCloseTo(4, 5);
  });

  it('drops item when pantry covers full amount', () => {
    const items = [item('flour', 1, 'cup')];
    const pantry: PantryItem[] = [{ id: '1', name: 'flour', quantity: 2, unit: 'cup' }];
    expect(applyPantry(items, pantry)).toHaveLength(0);
  });

  it('converts across compatible units when subtracting', () => {
    const items = [item('milk', 2, 'cup')];
    const pantry: PantryItem[] = [{ id: '1', name: 'milk', quantity: 16, unit: 'tbsp' }];
    const out = applyPantry(items, pantry);
    // 2 cups - 16 tbsp = 32 tbsp - 16 tbsp = 16 tbsp = 1 cup
    expect(out[0].entries[0].quantity).toBeCloseTo(1, 2);
  });

  it('leaves entry alone when units are incompatible', () => {
    const items = [item('flour', 1, 'cup')];
    const pantry: PantryItem[] = [{ id: '1', name: 'flour', quantity: 100, unit: 'g' }];
    const out = applyPantry(items, pantry);
    expect(out).toHaveLength(1);
    expect(out[0].entries[0].quantity).toBeCloseTo(1, 5);
  });

  it('ignores non-matching pantry items', () => {
    const items = [item('salt', 1, 'tsp')];
    const pantry: PantryItem[] = [{ id: '1', name: 'pepper' }];
    expect(applyPantry(items, pantry)).toHaveLength(1);
  });
});
