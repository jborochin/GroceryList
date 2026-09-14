import { finiteOr, positiveOr, toNutrition } from '../utils/numbers';

describe('finiteOr', () => {
  it('passes finite numbers through', () => {
    expect(finiteOr(3.5, 1)).toBe(3.5);
    expect(finiteOr(0, 1)).toBe(0);
    expect(finiteOr(-2, 1)).toBe(-2);
  });

  it('replaces NaN, ±Infinity, strings, null and undefined with the fallback', () => {
    expect(finiteOr(NaN, 7)).toBe(7);
    expect(finiteOr(Infinity, 7)).toBe(7);
    expect(finiteOr(-Infinity, 7)).toBe(7);
    expect(finiteOr('12', 7)).toBe(12);
    expect(finiteOr('abc', 7)).toBe(7);
    expect(finiteOr(null, 7)).toBe(7);
    expect(finiteOr(undefined, 7)).toBe(7);
  });
});

describe('positiveOr', () => {
  it('requires a finite value strictly greater than zero', () => {
    expect(positiveOr(2, 1)).toBe(2);
    expect(positiveOr(0, 1)).toBe(1);
    expect(positiveOr(-3, 1)).toBe(1);
    expect(positiveOr(NaN, 1)).toBe(1);
    expect(positiveOr('4', 1)).toBe(4);
  });
});

describe('toNutrition', () => {
  it('coerces each macro, defaulting anything non-finite or negative to zero', () => {
    expect(toNutrition({ calories: '250', proteinG: NaN, carbsG: -5, fatG: undefined })).toEqual({
      calories: 250,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('tolerates null, arrays and non-objects', () => {
    const zero = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    expect(toNutrition(null)).toEqual(zero);
    expect(toNutrition(undefined)).toEqual(zero);
    expect(toNutrition([1, 2])).toEqual(zero);
    expect(toNutrition('x')).toEqual(zero);
  });
});
