import {
  applyActivity,
  applyGoal,
  cmToFtIn,
  cmToIn,
  computeTargetCalories,
  ftInToCm,
  inToCm,
  kgToLb,
  lbToKg,
  macroGramsFromSplit,
  mifflinStJeor,
} from '../utils/tdeeCalculator';
import type { TdeeInputs } from '../types';
import foodPreferences from '../data/foodPreferences.json';

const baseInputs: TdeeInputs = {
  v: 1,
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  unitSystem: 'imperial',
};

describe('tdeeCalculator', () => {
  describe('mifflinStJeor', () => {
    it('matches reference value for male 30y / 180cm / 80kg', () => {
      const bmr = mifflinStJeor({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 });
      expect(bmr).toBe(1780);
    });

    it('matches reference value for female 30y / 165cm / 60kg', () => {
      const bmr = mifflinStJeor({ sex: 'female', age: 30, heightCm: 165, weightKg: 60 });
      expect(bmr).toBeCloseTo(1320.25, 2);
    });

    it('subtracts 5 per year of age', () => {
      const young = mifflinStJeor({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 });
      const old = mifflinStJeor({ sex: 'male', age: 40, heightCm: 180, weightKg: 80 });
      expect(young - old).toBe(50);
    });
  });

  describe('applyActivity', () => {
    it('applies each multiplier', () => {
      expect(applyActivity(1000, 'sedentary')).toBeCloseTo(1200, 5);
      expect(applyActivity(1000, 'light')).toBeCloseTo(1375, 5);
      expect(applyActivity(1000, 'moderate')).toBeCloseTo(1550, 5);
      expect(applyActivity(1000, 'active')).toBeCloseTo(1725, 5);
      expect(applyActivity(1000, 'very_active')).toBeCloseTo(1900, 5);
    });
  });

  describe('applyGoal', () => {
    it('subtracts 500 for cut, adds 500 for bulk, no change for maintain', () => {
      expect(applyGoal(2500, 'lose')).toBe(2000);
      expect(applyGoal(2500, 'maintain')).toBe(2500);
      expect(applyGoal(2500, 'gain')).toBe(3000);
    });

    it('clamps to 1200 kcal floor on aggressive cut', () => {
      expect(applyGoal(1500, 'lose')).toBe(1200);
      expect(applyGoal(1000, 'maintain')).toBe(1200);
    });
  });

  describe('computeTargetCalories', () => {
    it('produces a reasonable maintenance target for the reference male', () => {
      const target = computeTargetCalories(baseInputs);
      // BMR 1780 * 1.55 = 2759
      expect(target).toBe(2759);
    });

    it('respects the goal adjustment', () => {
      const cut = computeTargetCalories({ ...baseInputs, goal: 'lose' });
      const bulk = computeTargetCalories({ ...baseInputs, goal: 'gain' });
      expect(cut).toBe(2259);
      expect(bulk).toBe(3259);
    });

    it.each([
      ['under-age', { ...baseInputs, age: 10 }],
      ['over-age', { ...baseInputs, age: 130 }],
      ['negative weight', { ...baseInputs, weightKg: -1 }],
      ['too tall', { ...baseInputs, heightCm: 300 }],
      ['too short', { ...baseInputs, heightCm: 80 }],
      ['NaN age', { ...baseInputs, age: Number.NaN }],
    ])('returns null for invalid input: %s', (_label, bad) => {
      expect(computeTargetCalories(bad as TdeeInputs)).toBeNull();
    });
  });

  describe('macroGramsFromSplit', () => {
    it('splits calories per 4/4/9 kcal/g', () => {
      const grams = macroGramsFromSplit(2000, { proteinPct: 30, carbsPct: 40, fatPct: 30 });
      expect(grams).toEqual({ proteinG: 150, carbsG: 200, fatG: 67 });
    });
  });

  describe('unit conversions', () => {
    it('lb <-> kg round-trip', () => {
      expect(kgToLb(lbToKg(150))).toBeCloseTo(150, 5);
      expect(lbToKg(1)).toBeCloseTo(0.4536, 4);
    });

    it('in <-> cm round-trip', () => {
      expect(cmToIn(inToCm(70))).toBeCloseTo(70, 5);
      expect(inToCm(1)).toBeCloseTo(2.54, 5);
    });

    it('ftInToCm for 5\'10"', () => {
      expect(ftInToCm(5, 10)).toBeCloseTo(177.8, 1);
    });

    it('cmToFtIn carries inches=12 to feet', () => {
      // 152.4 cm = exactly 60 inches → 5'0"
      expect(cmToFtIn(152.4)).toEqual({ feet: 5, inches: 0 });
      // ~177.8 cm = 70 inches → 5'10"
      expect(cmToFtIn(177.8)).toEqual({ feet: 5, inches: 10 });
    });
  });

  describe('foodPreferences data integrity', () => {
    it('has unique trimmed keys for cuisines and dietary', () => {
      const cuisineKeys = foodPreferences.cuisines.map((c) => c.key);
      const dietaryKeys = foodPreferences.dietary.map((d) => d.key);
      expect(new Set(cuisineKeys).size).toBe(cuisineKeys.length);
      expect(new Set(dietaryKeys).size).toBe(dietaryKeys.length);
      for (const k of [...cuisineKeys, ...dietaryKeys]) {
        expect(k).toBe(k.trim());
        expect(k.length).toBeGreaterThan(0);
      }
    });

    it('every entry has a non-empty label', () => {
      for (const c of foodPreferences.cuisines) expect(c.label.trim().length).toBeGreaterThan(0);
      for (const d of foodPreferences.dietary) expect(d.label.trim().length).toBeGreaterThan(0);
    });
  });
});
