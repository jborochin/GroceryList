import { FoodLogEntry, Recipe, ScheduleCell } from '../types';
import { resolveCookFinish, slotForTime } from '../utils/cookFinish';
import { resolveDay } from '../utils/foodLogDay';
import { dateKeyToCell } from '../utils/planningWeek';

const DATE = '2026-03-12';
const { weekStart, day } = dateKeyToCell(DATE);

const cell = (over: Partial<ScheduleCell> = {}): ScheduleCell => ({
  id: 'cell-1',
  weekStart,
  day,
  slot: 'dinner',
  recipeId: 'r1',
  desiredServings: 2,
  ...over,
});

const recipe: Recipe = {
  id: 'r1',
  title: 'Chicken Curry',
  servings: 4,
  ingredients: [],
  nutritionPerServing: { calories: 500, proteinG: 30, carbsG: 40, fatG: 20 },
  createdAt: 0,
  updatedAt: 0,
};

const logEntry = (over: Partial<FoodLogEntry> = {}): FoodLogEntry => ({
  id: 'e1',
  date: DATE,
  slot: 'dinner',
  displayName: 'Chicken Curry',
  source: 'recipe',
  sourceId: 'r1',
  servingQty: 2,
  servingLabel: 'servings',
  nutrition: { calories: 1000, proteinG: 60, carbsG: 80, fatG: 40 },
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('slotForTime', () => {
  const at = (h: number, m = 0) => slotForTime(new Date(2026, 2, 12, h, m));

  it('reads the clock as a meal', () => {
    expect(at(7)).toBe('breakfast');
    expect(at(12)).toBe('lunch');
    expect(at(18, 30)).toBe('dinner');
    expect(at(23)).toBe('snack');
  });
});

describe('resolveCookFinish', () => {
  const now = new Date(2026, 2, 12, 18, 30);

  it("finds today's plan cell for this recipe and seeds from it", () => {
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [cell()],
      entries: [],
      now,
    });

    expect(result.cell?.id).toBe('cell-1');
    expect(result.slot).toBe('dinner');
    expect(result.servings).toBe(2);
  });

  it('ignores a cell whose recipe is a different one', () => {
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [cell({ recipeId: 'r2' })],
      entries: [],
      now,
    });
    expect(result.cell).toBeUndefined();
  });

  it('ignores a cell planned for another day', () => {
    const other = dateKeyToCell('2026-03-14');
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [cell({ weekStart: other.weekStart, day: other.day })],
      entries: [],
      now,
    });
    expect(result.cell).toBeUndefined();
  });

  it('ignores a cell already confirmed, so cooking twice does not double-log it', () => {
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [cell()],
      entries: [logEntry({ fromCellId: 'cell-1' })],
      now,
    });
    expect(result.cell).toBeUndefined();
  });

  it('ignores a cell the user already replaced with something else', () => {
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [cell()],
      entries: [logEntry({ id: 'e2', replacesCellId: 'cell-1', displayName: 'Takeout' })],
      now,
    });
    expect(result.cell).toBeUndefined();
  });

  it('falls back to the time of day and a single serving when nothing was planned', () => {
    const result = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells: [],
      entries: [],
      now: new Date(2026, 2, 12, 8, 0),
    });

    expect(result.cell).toBeUndefined();
    expect(result.slot).toBe('breakfast');
    expect(result.servings).toBe(1);
  });

  it('reads nothing from the stores it is handed', () => {
    const cells = [cell()];
    const entries: FoodLogEntry[] = [];
    const before = JSON.stringify(cells);

    resolveCookFinish({ date: DATE, recipeId: 'r1', cells, entries, now });

    expect(JSON.stringify(cells)).toBe(before);
    expect(entries).toEqual([]);
  });
});

// The load-bearing rule: the grocery list is built from schedule cells, and the
// ingredients for a cooked meal were already bought. Logging a finished cook
// must retire the projection WITHOUT removing the cell, exactly as "Ate this"
// does — see FoodLogEntry and resolveDay.
describe('finishing a cook leaves the plan intact', () => {
  it('turns the projected row into a logged one without touching the cell', () => {
    const cells = [cell()];

    const before = resolveDay(DATE, cells, [], [recipe]);
    expect(before.bySlot.dinner.map((r) => r.status)).toEqual(['projected']);

    const finish = resolveCookFinish({
      date: DATE,
      recipeId: 'r1',
      cells,
      entries: [],
      now: new Date(2026, 2, 12, 18, 30),
    });

    // What CookFinishSheet writes.
    const entry = logEntry({ fromCellId: finish.cell?.id });
    const after = resolveDay(DATE, cells, [entry], [recipe]);

    expect(after.bySlot.dinner.map((r) => r.status)).toEqual(['logged']);
    expect(cells).toEqual([cell()]);
  });

  it('does not double-count the day once the cook is logged', () => {
    const cells = [cell()];
    const projected = resolveDay(DATE, cells, [], [recipe]).totals.calories;

    const entry = logEntry({ fromCellId: 'cell-1' });
    const logged = resolveDay(DATE, cells, [entry], [recipe]).totals.calories;

    expect(projected).toBe(1000);
    expect(logged).toBe(1000);
  });
});
