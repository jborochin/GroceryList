import { frequentFoods, recentFoods, recentKey, recentToFoodItem } from '../utils/recentFoods';
import { FoodLogEntry } from '../types';

function entry(over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'e1',
    date: '2026-08-13',
    slot: 'breakfast',
    displayName: 'Greek yogurt',
    source: 'usda',
    sourceId: '2094095',
    servingQty: 1,
    servingLabel: '1 container',
    gramsPerServing: 170,
    nutrition: { calories: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('recentKey', () => {
  it('identifies a food by its source id', () => {
    expect(recentKey({ source: 'usda', sourceId: '123', displayName: 'X' })).toBe('usda:123');
  });

  it('falls back to the name so hand-typed foods still collapse', () => {
    expect(recentKey({ source: 'quick', sourceId: undefined, displayName: 'Coffee' })).toBe(
      'quick:name:coffee'
    );
    expect(recentKey({ source: 'quick', sourceId: '  ', displayName: 'COFFEE' })).toBe(
      'quick:name:coffee'
    );
  });
});

describe('recentFoods', () => {
  it('collapses repeat loggings and counts them', () => {
    const list = recentFoods([entry(), entry({ id: 'e2', createdAt: 2000 })]);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(2);
    expect(list[0].lastLoggedAt).toBe(2000);
  });

  it('orders by recency, not by count', () => {
    const list = recentFoods([
      entry({ id: 'a', sourceId: 'often', displayName: 'Oats', createdAt: 10 }),
      entry({ id: 'b', sourceId: 'often', displayName: 'Oats', createdAt: 20 }),
      entry({ id: 'c', sourceId: 'once', displayName: 'Apple', createdAt: 99 }),
    ]);
    expect(list.map((r) => r.displayName)).toEqual(['Apple', 'Oats']);
  });

  it('keeps the most recent serving choice, not the first', () => {
    const list = recentFoods([
      entry({ id: 'a', servingQty: 1, createdAt: 10 }),
      entry({
        id: 'b',
        servingQty: 2,
        createdAt: 20,
        nutrition: { calories: 200, proteinG: 34, carbsG: 12, fatG: 1.4 },
      }),
    ]);
    expect(list[0].servingQty).toBe(2);
    expect(list[0].nutrition.calories).toBe(200);
  });

  it('ignores meals confirmed from the plan', () => {
    // Those are recipes; the plan and the recipe library already surface them,
    // and they would crowd out the packaged foods this list exists for.
    const list = recentFoods([
      entry({ id: 'a', source: 'recipe', sourceId: 'r1', fromCellId: 'c1' }),
      entry({ id: 'b', displayName: 'Protein bar', sourceId: 'bar' }),
    ]);
    expect(list.map((r) => r.displayName)).toEqual(['Protein bar']);
  });

  it('keeps a replacement entry — that is a real food choice', () => {
    const list = recentFoods([entry({ id: 'a', replacesCellId: 'c1', displayName: 'Burrito' })]);
    expect(list.map((r) => r.displayName)).toEqual(['Burrito']);
  });

  it('respects the limit', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `e${i}`, sourceId: `s${i}`, createdAt: i })
    );
    expect(recentFoods(entries, 3)).toHaveLength(3);
  });

  it('returns nothing for an empty log', () => {
    expect(recentFoods([])).toEqual([]);
  });
});

describe('frequentFoods', () => {
  it('ranks by count, breaking ties on recency', () => {
    const list = frequentFoods([
      entry({ id: 'a', sourceId: 'often', displayName: 'Oats', createdAt: 1 }),
      entry({ id: 'b', sourceId: 'often', displayName: 'Oats', createdAt: 2 }),
      entry({ id: 'c', sourceId: 'once', displayName: 'Apple', createdAt: 99 }),
    ]);
    expect(list.map((r) => r.displayName)).toEqual(['Oats', 'Apple']);
  });

  it('applies its limit after ranking, not before', () => {
    const list = frequentFoods(
      [
        entry({ id: 'a', sourceId: 'rare', displayName: 'Rare', createdAt: 100 }),
        entry({ id: 'b', sourceId: 'often', displayName: 'Often', createdAt: 1 }),
        entry({ id: 'c', sourceId: 'often', displayName: 'Often', createdAt: 2 }),
      ],
      1
    );
    expect(list.map((r) => r.displayName)).toEqual(['Often']);
  });
});

describe('recentToFoodItem', () => {
  it('back-computes a per-100g basis so the serving picker still works', () => {
    const [recent] = recentFoods([entry()]);
    const item = recentToFoodItem(recent);
    // 100 kcal over 170 g
    expect(item.per100g?.calories).toBeCloseTo(58.82, 2);
    expect(item.servings).toEqual([{ label: '1 container', grams: 170 }]);
  });

  it('accounts for the logged quantity when back-computing', () => {
    const [recent] = recentFoods([
      entry({
        servingQty: 2,
        nutrition: { calories: 200, proteinG: 34, carbsG: 12, fatG: 1.4 },
      }),
    ]);
    // 200 kcal over 2 x 170 g is the same 58.82 per 100 g as one container.
    expect(recentToFoodItem(recent).per100g?.calories).toBeCloseTo(58.82, 2);
  });

  it('falls back to a per-serving basis when no gram weight was recorded', () => {
    // Regression: a custom food saved without a weight — the normal homemade
    // case — used to come back with no basis at all and re-log as 0 calories.
    const [recent] = recentFoods([
      entry({
        source: 'custom',
        sourceId: 'bowl-of-chilli',
        displayName: 'Chilli',
        servingLabel: 'bowl',
        gramsPerServing: undefined,
        nutrition: { calories: 400, proteinG: 30, carbsG: 40, fatG: 12 },
      }),
    ]);
    const item = recentToFoodItem(recent);
    expect(item.per100g).toBeUndefined();
    expect(item.perServing).toEqual({ calories: 400, proteinG: 30, carbsG: 40, fatG: 12 });
    // The serving survives with grams 0 — it is a unit, just not a weight.
    expect(item.servings).toEqual([{ label: 'bowl', grams: 0 }]);
  });

  it('divides an unweighed multi-serving entry down to one serving', () => {
    const [recent] = recentFoods([
      entry({
        source: 'custom',
        sourceId: 'chilli',
        servingQty: 2,
        servingLabel: 'bowl',
        gramsPerServing: undefined,
        nutrition: { calories: 800, proteinG: 60, carbsG: 80, fatG: 24 },
      }),
    ]);
    expect(recentToFoodItem(recent).perServing?.calories).toBe(400);
  });

  it('prefers the gram basis and sets no perServing when a weight exists', () => {
    const [recent] = recentFoods([entry()]);
    const item = recentToFoodItem(recent);
    expect(item.per100g).toBeDefined();
    expect(item.perServing).toBeUndefined();
  });
});
