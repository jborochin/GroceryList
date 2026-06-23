import { sumServingsByRecipe } from '../utils/scheduleToPlan';
import { ScheduleCell } from '../types';

const cell = (recipeId: string, desiredServings: number, day = 0, slot: ScheduleCell['slot'] = 'dinner'): ScheduleCell => ({
  id: `${recipeId}-${day}-${slot}`,
  day,
  slot,
  recipeId,
  desiredServings,
});

describe('sumServingsByRecipe', () => {
  it('returns an empty map for no cells', () => {
    expect(sumServingsByRecipe([]).size).toBe(0);
  });

  it('sums servings across multiple cells of the same recipe', () => {
    const totals = sumServingsByRecipe([
      cell('a', 2, 0, 'dinner'),
      cell('a', 3, 2, 'lunch'),
    ]);
    expect(totals.get('a')).toBe(5);
    expect(totals.size).toBe(1);
  });

  it('keeps distinct recipes separate', () => {
    const totals = sumServingsByRecipe([
      cell('a', 2),
      cell('b', 4, 1),
      cell('a', 1, 3, 'breakfast'),
    ]);
    expect(totals.get('a')).toBe(3);
    expect(totals.get('b')).toBe(4);
    expect(totals.size).toBe(2);
  });
});
