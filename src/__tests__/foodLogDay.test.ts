import { resolveDay, nutritionForCell, SLOT_ORDER } from '../utils/foodLogDay';
import { FoodLogEntry, Recipe, ScheduleCell } from '../types';
import { dateKeyToCell } from '../utils/planningWeek';

// A Thursday, so the day index is a non-zero column of the schedule grid — a
// Monday would pass even if dateKeyToCell always returned 0.
const DATE = '2026-08-13';
const { weekStart, day } = dateKeyToCell(DATE);

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Chicken fajitas',
    servings: 2,
    ingredients: [],
    nutritionPerServing: { calories: 400, proteinG: 30, carbsG: 35, fatG: 14 },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function cell(over: Partial<ScheduleCell> = {}): ScheduleCell {
  return {
    id: 'c1',
    weekStart,
    day,
    slot: 'dinner',
    recipeId: 'r1',
    desiredServings: 2,
    ...over,
  };
}

function entry(over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'e1',
    date: DATE,
    slot: 'breakfast',
    displayName: 'Greek yogurt',
    source: 'usda',
    servingQty: 1,
    servingLabel: 'container',
    nutrition: { calories: 150, proteinG: 15, carbsG: 8, fatG: 4 },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('resolveDay', () => {
  it('projects a planned meal into the day totals before anything is logged', () => {
    const day1 = resolveDay(DATE, [cell()], [], [recipe()]);

    expect(day1.bySlot.dinner).toHaveLength(1);
    expect(day1.bySlot.dinner[0].status).toBe('projected');
    // 2 servings x 400 kcal
    expect(day1.totals.calories).toBe(800);
    expect(day1.projected.calories).toBe(800);
    expect(day1.hasProjected).toBe(true);
  });

  it('counts a logged entry as fact, with nothing projected', () => {
    const day1 = resolveDay(DATE, [], [entry()], []);

    expect(day1.bySlot.breakfast[0].status).toBe('logged');
    expect(day1.totals.calories).toBe(150);
    expect(day1.projected.calories).toBe(0);
    expect(day1.hasProjected).toBe(false);
  });

  it('stops projecting a cell once an entry confirms it, without changing the total', () => {
    const planned = resolveDay(DATE, [cell()], [], [recipe()]);
    const confirmed = resolveDay(
      DATE,
      [cell()],
      [
        entry({
          id: 'e2',
          slot: 'dinner',
          displayName: 'Chicken fajitas',
          source: 'recipe',
          fromCellId: 'c1',
          nutrition: { calories: 800, proteinG: 60, carbsG: 70, fatG: 28 },
        }),
      ],
      [recipe()]
    );

    // The whole point of "Ate this": the number was already right, so
    // confirming it must not double it.
    expect(confirmed.totals.calories).toBe(planned.totals.calories);
    expect(confirmed.bySlot.dinner).toHaveLength(1);
    expect(confirmed.bySlot.dinner[0].status).toBe('logged');
    expect(confirmed.projected.calories).toBe(0);
  });

  it('drops a replaced cell and counts only what was eaten instead', () => {
    const summary = resolveDay(
      DATE,
      [cell()],
      [
        entry({
          id: 'e3',
          slot: 'dinner',
          displayName: 'Burrito',
          replacesCellId: 'c1',
          nutrition: { calories: 620, proteinG: 25, carbsG: 70, fatG: 24 },
        }),
      ],
      [recipe()]
    );

    expect(summary.bySlot.dinner).toHaveLength(1);
    expect(summary.bySlot.dinner[0].title).toBe('Burrito');
    expect(summary.totals.calories).toBe(620);
    expect(summary.projected.calories).toBe(0);
  });

  it('answers a cell even when the entry was logged on a different day', () => {
    // Logging a Thursday dinner just after midnight on Friday must still retire
    // Thursday's plan row, or it projects forever.
    const summary = resolveDay(
      DATE,
      [cell()],
      [entry({ id: 'e4', date: '2026-08-14', slot: 'dinner', fromCellId: 'c1' })],
      [recipe()]
    );

    expect(summary.bySlot.dinner).toHaveLength(0);
    expect(summary.totals.calories).toBe(0);
  });

  it('ignores cells from other days and other weeks', () => {
    const summary = resolveDay(
      DATE,
      [
        cell(),
        cell({ id: 'c2', day: (day + 1) % 7 }),
        cell({ id: 'c3', weekStart: '2026-08-03' }),
      ],
      [],
      [recipe()]
    );

    expect(summary.bySlot.dinner).toHaveLength(1);
    expect(summary.bySlot.dinner[0].cell?.id).toBe('c1');
  });

  it('ignores log entries from other days', () => {
    const summary = resolveDay(DATE, [], [entry(), entry({ id: 'e5', date: '2026-08-12' })], []);
    expect(summary.bySlot.breakfast).toHaveLength(1);
    expect(summary.totals.calories).toBe(150);
  });

  it('still shows a planned meal whose recipe was deleted, and flags the gap', () => {
    const summary = resolveDay(DATE, [cell()], [], []);

    expect(summary.bySlot.dinner).toHaveLength(1);
    expect(summary.bySlot.dinner[0].nutrition.calories).toBe(0);
    expect(summary.hasMissingRecipe).toBe(true);
    expect(summary.totals.calories).toBe(0);
  });

  it('flags a recipe that carries no nutrition data', () => {
    const summary = resolveDay(DATE, [cell()], [], [recipe({ nutritionPerServing: undefined })]);
    expect(summary.hasMissingRecipe).toBe(true);
    expect(summary.totals.calories).toBe(0);
  });

  it('sorts logged rows ahead of projected ones within a slot', () => {
    const summary = resolveDay(
      DATE,
      [cell()],
      [entry({ id: 'e6', slot: 'dinner', displayName: 'Side salad' })],
      [recipe()]
    );

    expect(summary.bySlot.dinner.map((r) => r.status)).toEqual(['logged', 'projected']);
  });

  it('sums logged and projected across every slot', () => {
    const summary = resolveDay(
      DATE,
      [cell({ id: 'c4', slot: 'lunch', desiredServings: 1 })],
      [entry(), entry({ id: 'e7', slot: 'snack', nutrition: { calories: 90, proteinG: 1, carbsG: 22, fatG: 0 } })],
      [recipe()]
    );

    // 150 breakfast + 400 lunch (projected) + 90 snack
    expect(summary.totals.calories).toBe(640);
    expect(summary.projected.calories).toBe(400);
  });

  it('returns an entry for every slot even when the day is empty', () => {
    const summary = resolveDay(DATE, [], [], []);
    for (const slot of SLOT_ORDER) {
      expect(summary.bySlot[slot]).toEqual([]);
    }
    expect(summary.totals).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe('nutritionForCell', () => {
  it('scales per-serving nutrition by the cell servings', () => {
    expect(nutritionForCell(cell({ desiredServings: 3 }), recipe())).toEqual({
      calories: 1200,
      proteinG: 90,
      carbsG: 105,
      fatG: 42,
    });
  });

  it('returns null when there is nothing to scale', () => {
    expect(nutritionForCell(cell(), undefined)).toBeNull();
    expect(nutritionForCell(cell(), recipe({ nutritionPerServing: undefined }))).toBeNull();
  });
});
