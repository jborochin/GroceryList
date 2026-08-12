import {
  GRAM_SERVING,
  nutritionForServing,
  roundNutrition,
  servingOptions,
  totalGrams,
} from '../utils/servingMath';
import { NutritionPerServing } from '../types';

const YOGURT: NutritionPerServing = { calories: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 };

describe('servingOptions', () => {
  it('keeps source order and always offers grams as a fallback', () => {
    const options = servingOptions({
      servings: [
        { label: '1 container', grams: 170 },
        { label: '1 cup', grams: 245 },
      ],
    });
    expect(options.map((s) => s.label)).toEqual(['1 container', '1 cup', 'g']);
  });

  it('gives a food with no published servings something to pick', () => {
    expect(servingOptions({ servings: [] })).toEqual([GRAM_SERVING]);
  });

  it('drops junk servings rather than offering a zero-gram portion', () => {
    const options = servingOptions({
      servings: [
        { label: '', grams: 100 },
        { label: 'bad', grams: 0 },
        { label: 'ok', grams: 30 },
      ],
    });
    expect(options).toEqual([{ label: 'ok', grams: 30 }, GRAM_SERVING]);
  });

  it('dedupes labels case-insensitively, keeping the first', () => {
    const options = servingOptions({
      servings: [
        { label: '1 Cup', grams: 240 },
        { label: '1 cup', grams: 999 },
      ],
    });
    expect(options).toEqual([{ label: '1 Cup', grams: 240 }, GRAM_SERVING]);
  });

  it('does not add a second gram entry when the source already published one', () => {
    const options = servingOptions({ servings: [{ label: 'g', grams: 1 }] });
    expect(options).toHaveLength(1);
  });
});

describe('nutritionForServing', () => {
  it('scales per-100g by the serving gram weight', () => {
    const n = nutritionForServing(YOGURT, { label: '1 container', grams: 170 }, 1);
    expect(n.calories).toBeCloseTo(100.3, 5);
    expect(n.proteinG).toBeCloseTo(17, 5);
  });

  it('multiplies by the quantity', () => {
    const one = nutritionForServing(YOGURT, { label: 'g', grams: 1 }, 100);
    expect(one.calories).toBeCloseTo(59, 5);
    const two = nutritionForServing(YOGURT, { label: 'g', grams: 1 }, 200);
    expect(two.calories).toBeCloseTo(118, 5);
  });

  it('returns zeroes rather than NaN for a food with no basis', () => {
    expect(nutritionForServing(undefined, GRAM_SERVING, 100)).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('returns zeroes for a non-positive quantity or serving', () => {
    expect(nutritionForServing(YOGURT, GRAM_SERVING, 0).calories).toBe(0);
    expect(nutritionForServing(YOGURT, GRAM_SERVING, -5).calories).toBe(0);
    expect(nutritionForServing(YOGURT, { label: 'x', grams: 0 }, 1).calories).toBe(0);
    expect(nutritionForServing(YOGURT, GRAM_SERVING, NaN).calories).toBe(0);
  });
});

describe('totalGrams', () => {
  it('multiplies serving weight by quantity', () => {
    expect(totalGrams({ label: '1 container', grams: 170 }, 2)).toBe(340);
  });

  it('refuses non-finite input', () => {
    expect(totalGrams({ label: 'x', grams: Infinity }, 1)).toBe(0);
    expect(totalGrams({ label: 'x', grams: 10 }, Infinity)).toBe(0);
  });
});

describe('roundNutrition', () => {
  it('rounds calories whole and macros to a tenth', () => {
    expect(roundNutrition({ calories: 100.34, proteinG: 17.02, carbsG: 6.129, fatG: 0.68 })).toEqual(
      { calories: 100, proteinG: 17, carbsG: 6.1, fatG: 0.7 }
    );
  });
});
