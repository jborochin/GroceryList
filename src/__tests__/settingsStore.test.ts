import { useSettingsStore, sanitizeSettings } from '../store/useSettingsStore';
import { UserSettings } from '../types';

const base: UserSettings = {
  dailyCalorieTarget: 2200,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  macroGrams: { proteinG: 160, carbsG: 220, fatG: 70 },
  reduceVisualEffects: false,
  onboardingCompleted: true,
  tdeeInputs: null,
  cuisinePreferences: ['thai'],
  dietaryRestrictions: [],
  cookingFrequency: 'daily',
  cookingEasePreference: 0.5,
};

describe('sanitizeSettings', () => {
  it('replaces NaN targets with defaults and clamps the rest', () => {
    const s = sanitizeSettings({
      ...base,
      dailyCalorieTarget: NaN,
      macroGrams: { proteinG: Infinity, carbsG: -4, fatG: 5000 },
      macroSplit: { proteinPct: NaN, carbsPct: 40, fatPct: 30 },
      cookingEasePreference: NaN,
    });
    expect(s.dailyCalorieTarget).toBe(2000);
    expect(s.macroGrams).toEqual({ proteinG: 150, carbsG: 0, fatG: 1000 });
    expect(s.macroSplit).toEqual({ proteinPct: 30, carbsPct: 40, fatPct: 30 });
    expect(s.cookingEasePreference).toBe(0.5);
  });

  it('leaves valid settings untouched', () => {
    expect(sanitizeSettings(base)).toEqual(base);
  });
});

describe('hydrateFromServer', () => {
  it('never stores a NaN calorie target (the planner would fill zero slots)', () => {
    useSettingsStore.getState().hydrateFromServer({ ...base, dailyCalorieTarget: NaN });
    expect(useSettingsStore.getState().settings.dailyCalorieTarget).toBe(2000);
  });
});
