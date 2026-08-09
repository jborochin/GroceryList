import { getProfile } from '../utils/purchaseProfile';
import { roundToPurchasable } from '../utils/purchaseRounding';
import { getFamily } from '../utils/unitConversion';
import { normalizeName } from '../utils/normalizeName';
import catalog from '../data/mealCatalog.json';
import { GroceryItem, Meal } from '../types';

// Regression guard: every catalog ingredient must resolve to a purchase profile (so it can be
// rounded to a real purchase), and rounding must never leave a fractional *count* — that's the
// whole promise of the feature ("you can't buy 1/4 of an avocado").
describe('purchase profile coverage', () => {
  const meals = catalog as Meal[];

  it('every catalog ingredient resolves to a profile', () => {
    const misses: string[] = [];
    for (const meal of meals) {
      for (const ing of meal.ingredients) {
        if (!getProfile(ing.name)) misses.push(`${meal.id}: ${ing.name}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('rounding never leaves a fractional count for any catalog ingredient', () => {
    const bad: string[] = [];
    for (const meal of meals) {
      for (const ing of meal.ingredients) {
        const item: GroceryItem = {
          name: normalizeName(ing.name),
          displayName: ing.name,
          category: 'Other',
          entries: [{ quantity: ing.quantity, unit: ing.unit }],
          hasPriceGap: false,
        };
        const [rounded] = roundToPurchasable([item]);
        for (const e of rounded.entries) {
          if (getFamily(e.unit) === 'count' && !Number.isInteger(e.quantity)) {
            bad.push(`${meal.id}: ${ing.quantity} ${ing.unit} ${ing.name} → ${e.quantity} ${e.unit}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
