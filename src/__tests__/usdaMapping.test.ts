import { extractPer100g, extractPortions, canonicalPortionUnit, mapFoodDetail } from '../utils/usdaMapping';

// Shape mirrors a real FDC /food/{id} detail for an SR Legacy food.
const sampleFood = {
  foodNutrients: [
    { nutrient: { number: '208', name: 'Energy', unitName: 'kJ' }, amount: 837 }, // kJ row (ignored)
    { nutrient: { number: '208', name: 'Energy', unitName: 'KCAL' }, amount: 200 },
    { nutrient: { number: '203', name: 'Protein', unitName: 'G' }, amount: 27 },
    { nutrient: { number: '205', name: 'Carbohydrate, by difference', unitName: 'G' }, amount: 0 },
    { nutrient: { number: '204', name: 'Total lipid (fat)', unitName: 'G' }, amount: 10 },
  ],
  foodPortions: [
    { amount: 1, gramWeight: 240, measureUnit: { name: 'cup' }, modifier: 'chopped' },
    { amount: 1, gramWeight: 150, measureUnit: { name: 'undetermined' }, modifier: '1 medium' },
    { amount: 2, gramWeight: 30, measureUnit: { name: 'tablespoon' } },
  ],
};

describe('usdaMapping', () => {
  it('extracts per-100g macros and prefers KCAL over kJ for energy', () => {
    expect(extractPer100g(sampleFood)).toEqual({
      calories: 200,
      proteinG: 27,
      carbsG: 0,
      fatG: 10,
    });
  });

  it('falls back to an Atwater kcal Energy row when number 208 is absent', () => {
    // Mirrors Foundation foods (e.g. raw cauliflower) that omit the legacy 208 row.
    const atwaterFood = {
      foodNutrients: [
        { nutrient: { number: '2047', name: 'Energy (Atwater General Factors)', unitName: 'KCAL' }, amount: 25 },
        { nutrient: { number: '203', name: 'Protein', unitName: 'G' }, amount: 1.9 },
        { nutrient: { number: '205', name: 'Carbohydrate, by difference', unitName: 'G' }, amount: 5 },
        { nutrient: { number: '204', name: 'Total lipid (fat)', unitName: 'G' }, amount: 0.3 },
      ],
    };
    expect(extractPer100g(atwaterFood).calories).toBe(25);
  });

  it('canonicalizes household-measure labels to our units', () => {
    expect(canonicalPortionUnit('cup chopped')).toBe('cup');
    expect(canonicalPortionUnit('tablespoon')).toBe('tbsp');
    expect(canonicalPortionUnit('undetermined 1 medium')).toBe('each');
    expect(canonicalPortionUnit('fluid ounce')).toBe('fl_oz');
    expect(canonicalPortionUnit('mystery')).toBeNull();
  });

  it('normalizes portions to grams-per-unit keyed by canonical unit', () => {
    const portions = extractPortions(sampleFood);
    expect(portions.cup).toBe(240); // 240 g / 1
    expect(portions.each).toBe(150); // "1 medium"
    expect(portions.tbsp).toBe(15); // 30 g / 2 tbsp
  });

  it('mapFoodDetail combines both', () => {
    const m = mapFoodDetail(sampleFood);
    expect(m.per100g.calories).toBe(200);
    expect(m.portions.cup).toBe(240);
  });
});
