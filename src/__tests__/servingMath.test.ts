import {
  GRAM_SERVING,
  nutritionForServing,
  roundNutrition,
  servingOptions,
  totalGrams,
} from '../utils/servingMath';
import { NutritionPerServing } from '../types';

const YOGURT: NutritionPerServing = { calories: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 };
// A homemade dish: known per serving, never weighed.
const BOWL: NutritionPerServing = { calories: 400, proteinG: 30, carbsG: 40, fatG: 12 };

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

  it('keeps an unweighable serving when the food is priced per serving', () => {
    // Without this the picker would show only "g" for a homemade dish, and
    // grams of a massless food is guaranteed 0 kcal.
    const options = servingOptions({
      servings: [{ label: 'bowl', grams: 0 }],
      perServing: BOWL,
    });
    expect(options).toEqual([{ label: 'bowl', grams: 0 }]);
  });

  it('still offers grams to a perServing food that has no serving of its own', () => {
    expect(servingOptions({ servings: [], perServing: BOWL })).toEqual([GRAM_SERVING]);
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
    const n = nutritionForServing({ per100g: YOGURT }, { label: '1 container', grams: 170 }, 1);
    expect(n.calories).toBeCloseTo(100.3, 5);
    expect(n.proteinG).toBeCloseTo(17, 5);
  });

  it('multiplies by the quantity', () => {
    const one = nutritionForServing({ per100g: YOGURT }, { label: 'g', grams: 1 }, 100);
    expect(one.calories).toBeCloseTo(59, 5);
    const two = nutritionForServing({ per100g: YOGURT }, { label: 'g', grams: 1 }, 200);
    expect(two.calories).toBeCloseTo(118, 5);
  });

  it('counts servings for a food that was never weighed', () => {
    // The homemade case: someone knows a bowl of their chilli is 400 kcal but
    // has no idea what it weighs. Before perServing existed this logged as 0.
    const item = { perServing: BOWL };
    expect(nutritionForServing(item, { label: 'bowl', grams: 0 }, 1)).toEqual(BOWL);
    expect(nutritionForServing(item, { label: 'bowl', grams: 0 }, 2).calories).toBe(800);
  });

  it('prefers the gram basis when a food has both', () => {
    // per100g can express any portion; perServing can only count whole servings.
    const n = nutritionForServing(
      { per100g: YOGURT, perServing: BOWL },
      { label: 'g', grams: 1 },
      100
    );
    expect(n.calories).toBeCloseTo(59, 5);
  });

  it('falls back to servings when the gram basis exists but the serving has no weight', () => {
    const n = nutritionForServing(
      { per100g: YOGURT, perServing: BOWL },
      { label: 'bowl', grams: 0 },
      1
    );
    expect(n).toEqual(BOWL);
  });

  it('returns zeroes rather than NaN for a food with no basis', () => {
    expect(nutritionForServing({}, GRAM_SERVING, 100)).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('returns zeroes for a non-positive quantity or serving', () => {
    expect(nutritionForServing({ per100g: YOGURT }, GRAM_SERVING, 0).calories).toBe(0);
    expect(nutritionForServing({ per100g: YOGURT }, GRAM_SERVING, -5).calories).toBe(0);
    expect(nutritionForServing({ per100g: YOGURT }, { label: 'x', grams: 0 }, 1).calories).toBe(0);
    expect(nutritionForServing({ per100g: YOGURT }, GRAM_SERVING, NaN).calories).toBe(0);
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
