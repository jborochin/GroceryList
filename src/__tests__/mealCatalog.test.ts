import { MEAL_CATALOG } from '../data/mealCatalog';
import foodPreferences from '../data/foodPreferences.json';
import unitSynonyms from '../data/unitSynonyms.json';
import { normalizeName } from '../utils/normalizeName';
import type { MealSlot } from '../types';

// These invariants guard the shared meal catalog. mealCatalog.ts casts the raw
// JSON `as Meal[]` with no runtime validation, and the catalog drives meal-plan
// generation (src/utils/mealPlanner.ts) plus the grocery pipeline — so a bad
// row would ship silently. Keep this in sync when editing mealCatalog.json.

const VALID_CUISINES = new Set(foodPreferences.cuisines.map((c) => c.key));
const VALID_DIETARY = new Set(foodPreferences.dietary.map((d) => d.key));
const VALID_SLOTS: ReadonlySet<MealSlot> = new Set<MealSlot>([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]);
const CANONICAL_UNITS = new Set(Object.keys(unitSynonyms));

describe('mealCatalog invariants', () => {
  it('has a non-trivial number of meals', () => {
    expect(MEAL_CATALOG.length).toBeGreaterThanOrEqual(80);
  });

  it('has unique stable slug ids', () => {
    const ids = MEAL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only known cuisine keys', () => {
    const bad = MEAL_CATALOG.filter((m) => !VALID_CUISINES.has(m.cuisine));
    expect(bad.map((m) => `${m.id}:${m.cuisine}`)).toEqual([]);
  });

  it('uses only known dietary tag keys', () => {
    const bad = MEAL_CATALOG.flatMap((m) =>
      m.dietaryTags.filter((t) => !VALID_DIETARY.has(t)).map((t) => `${m.id}:${t}`)
    );
    expect(bad).toEqual([]);
  });

  it('declares at least one valid meal slot per meal', () => {
    for (const m of MEAL_CATALOG) {
      expect(m.slots.length).toBeGreaterThan(0);
      for (const s of m.slots) {
        expect(VALID_SLOTS.has(s)).toBe(true);
      }
    }
  });

  it('has complete, sane nutrition (calories > 0, macros >= 0)', () => {
    for (const m of MEAL_CATALOG) {
      const n = m.nutritionPerServing;
      expect(n).toBeDefined();
      expect(n.calories).toBeGreaterThan(0);
      expect(n.proteinG).toBeGreaterThanOrEqual(0);
      expect(n.carbsG).toBeGreaterThanOrEqual(0);
      expect(n.fatG).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps vegan a subset of vegetarian', () => {
    const bad = MEAL_CATALOG.filter(
      (m) => m.dietaryTags.includes('vegan') && !m.dietaryTags.includes('vegetarian')
    );
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it('uses canonical units and normalizable ingredient names', () => {
    for (const m of MEAL_CATALOG) {
      expect(m.ingredients.length).toBeGreaterThan(0);
      for (const ing of m.ingredients) {
        expect(CANONICAL_UNITS.has(ing.unit)).toBe(true);
        expect(normalizeName(ing.name).length).toBeGreaterThan(0);
      }
    }
  });
});
