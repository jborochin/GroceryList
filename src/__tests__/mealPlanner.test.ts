import { planMeals, PlannerInput, SlotConfig } from '../utils/mealPlanner';
import type { Meal } from '../types';

function meal(partial: Partial<Meal> & Pick<Meal, 'id'>): Meal {
  return {
    title: partial.id,
    cuisine: 'american',
    slots: ['lunch', 'dinner'],
    dietaryTags: [],
    servings: 1,
    ingredients: [],
    nutritionPerServing: { calories: 500, proteinG: 30, carbsG: 50, fatG: 18 },
    ...partial,
  };
}

const SLOTS_3: SlotConfig[] = [
  { slot: 'breakfast', mealsPerDay: 1 },
  { slot: 'lunch', mealsPerDay: 1 },
  { slot: 'dinner', mealsPerDay: 1 },
];

const TARGETS = {
  dailyCalories: 2000,
  macroGrams: { proteinG: 150, carbsG: 200, fatG: 67 },
};

function baseInput(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    targets: TARGETS,
    cuisinePreferences: [],
    dietaryRestrictions: [],
    meals: [],
    days: 1,
    slots: SLOTS_3,
    ...overrides,
  };
}

describe('planMeals', () => {
  it('excludes meals that do not satisfy every dietary restriction', () => {
    const meals = [
      meal({ id: 'veg', slots: ['breakfast', 'lunch', 'dinner'], dietaryTags: ['vegetarian'] }),
      meal({ id: 'meat', slots: ['breakfast', 'lunch', 'dinner'], dietaryTags: [] }),
    ];
    const result = planMeals(baseInput({ meals, dietaryRestrictions: ['vegetarian'] }));
    const used = new Set(result.items.map((i) => i.mealId));
    expect(used.has('meat')).toBe(false);
    expect(used.has('veg')).toBe(true);
  });

  it('biases toward preferred cuisines when macros are otherwise equal', () => {
    const meals = [
      meal({ id: 'a-american', cuisine: 'american', slots: ['lunch'] }),
      meal({ id: 'b-thai', cuisine: 'thai', slots: ['lunch'] }),
    ];
    // Single slot so the variety penalty can't override the cuisine bonus.
    const result = planMeals(
      baseInput({ meals, cuisinePreferences: ['thai'], slots: [{ slot: 'lunch', mealsPerDay: 1 }] })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].mealId).toBe('b-thai');
  });

  it('approaches the daily protein target within tolerance', () => {
    // A balanced pool that can roughly hit 2000 kcal / 150g protein across 3 slots.
    const meals = [
      meal({ id: 'eggs', slots: ['breakfast'], nutritionPerServing: { calories: 650, proteinG: 50, carbsG: 60, fatG: 22 } }),
      meal({ id: 'chicken', slots: ['lunch'], nutritionPerServing: { calories: 670, proteinG: 50, carbsG: 65, fatG: 22 } }),
      meal({ id: 'salmon', slots: ['dinner'], nutritionPerServing: { calories: 680, proteinG: 50, carbsG: 70, fatG: 23 } }),
    ];
    const result = planMeals(baseInput({ meals }));
    const day = result.dailyTotals[0];
    expect(result.unfilledSlots).toBe(0);
    expect(Math.abs(day.proteinG - 150) / 150).toBeLessThan(0.15);
    expect(Math.abs(day.calories - 2000) / 2000).toBeLessThan(0.15);
  });

  it('counts unfilled slots when a slot has no eligible candidate', () => {
    const meals = [meal({ id: 'lunch-only', slots: ['lunch'] })];
    const result = planMeals(baseInput({ meals }));
    // breakfast + dinner cannot be filled.
    expect(result.unfilledSlots).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it('is deterministic for identical input', () => {
    const meals = [
      meal({ id: 'a', slots: ['breakfast', 'lunch', 'dinner'] }),
      meal({ id: 'b', slots: ['breakfast', 'lunch', 'dinner'] }),
      meal({ id: 'c', slots: ['breakfast', 'lunch', 'dinner'] }),
    ];
    const input = baseInput({ meals, days: 3 });
    const a = planMeals(input);
    const b = planMeals(input);
    expect(a.items).toEqual(b.items);
  });

  it('spreads repeated days via the variety penalty', () => {
    const meals = [
      meal({ id: 'a', slots: ['breakfast', 'lunch', 'dinner'] }),
      meal({ id: 'b', slots: ['breakfast', 'lunch', 'dinner'] }),
    ];
    const result = planMeals(baseInput({ meals, days: 4 }));
    const distinct = new Set(result.items.map((i) => i.mealId));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('repeats fewer distinct meals for batch cooking than for daily', () => {
    const meals = [
      meal({ id: 'a', slots: ['lunch'] }),
      meal({ id: 'b', slots: ['lunch'] }),
      meal({ id: 'c', slots: ['lunch'] }),
    ];
    const slots: SlotConfig[] = [{ slot: 'lunch', mealsPerDay: 1 }];

    const batch = planMeals(baseInput({ meals, slots, days: 5, cookingFrequency: 'batch' }));
    const daily = planMeals(baseInput({ meals, slots, days: 5, cookingFrequency: 'daily' }));

    const batchDistinct = new Set(batch.items.map((i) => i.mealId)).size;
    const dailyDistinct = new Set(daily.items.map((i) => i.mealId)).size;

    // Batch cook reuses one dish all week; daily fans out across the pool.
    expect(batchDistinct).toBe(1);
    expect(dailyDistinct).toBeGreaterThan(batchDistinct);
  });
});
