import { findPrice } from '../utils/priceEstimator';
import { isKnownUnit } from '../utils/unitConversion';
import catalog from '../data/mealCatalog.json';
import { Meal } from '../types';

// Regression guard: every catalog ingredient must resolve to a price entry and
// use a known unit, or auto-generated plans show price gaps users can't fix.
describe('meal catalog coverage', () => {
  const meals = catalog as Meal[];

  it('every catalog ingredient has a price match', () => {
    const misses: string[] = [];
    for (const meal of meals) {
      for (const ing of meal.ingredients) {
        if (!findPrice(ing.name)) misses.push(`${meal.id}: ${ing.name}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('every catalog ingredient uses a known unit', () => {
    const unknown: string[] = [];
    for (const meal of meals) {
      for (const ing of meal.ingredients) {
        if (!isKnownUnit(ing.unit)) unknown.push(`${meal.id}: ${ing.quantity} ${ing.unit} ${ing.name}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
