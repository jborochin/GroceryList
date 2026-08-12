import {
  extractPer100g,
  extractServings,
  ingestFoodItems,
  mapOffProduct,
  mapUsdaFood,
  mapUsdaSearch,
} from '../utils/foodSearchMapping';
import usdaSearch from './fixtures/food/usdaSearch.json';
import offProduct from './fixtures/food/offProduct.json';

// The fixtures mirror the documented FoodData Central and Open Food Facts
// payload shapes. Liveness against the real APIs is checked by
// `npm run food:probe`, not here — a unit test that hits the network is a test
// that fails on a plane.

describe('mapUsdaSearch', () => {
  const items = mapUsdaSearch(usdaSearch);

  it('maps a branded product with its label serving', () => {
    const yogurt = items.find((i) => i.sourceId === '2094095');
    expect(yogurt).toMatchObject({
      source: 'usda',
      name: 'GREEK YOGURT, PLAIN',
      brand: 'CHOBANI',
      barcode: '0894700010045',
      per100g: { calories: 59, proteinG: 10, carbsG: 3.6, fatG: 0.4 },
    });
    expect(yogurt?.servings[0]).toEqual({ label: '1 container', grams: 170 });
  });

  it('maps a whole food from its foodMeasures', () => {
    const banana = items.find((i) => i.sourceId === '173944');
    expect(banana?.per100g?.calories).toBe(89);
    expect(banana?.brand).toBeUndefined();
    expect(banana?.servings).toEqual([
      { label: '1 medium (7" to 7-7/8" long)', grams: 118 },
      { label: '1 cup, sliced', grams: 150 },
    ]);
  });

  it('drops rows with neither energy nor protein', () => {
    // Bottled water is a real FDC row with an all-zero nutrient block. Logging
    // it would put a food in someone's diary that can never contribute.
    expect(items.some((i) => i.name.includes('WATER'))).toBe(false);
    expect(items).toHaveLength(2);
  });

  it('survives a malformed payload', () => {
    expect(mapUsdaSearch(null)).toEqual([]);
    expect(mapUsdaSearch({})).toEqual([]);
    expect(mapUsdaSearch({ foods: 'nope' })).toEqual([]);
    expect(mapUsdaSearch({ foods: [null, 3, {}] })).toEqual([]);
  });
});

describe('extractPer100g', () => {
  it('reads the nested detail-response shape as well as the flat search one', () => {
    const detail = {
      foodNutrients: [
        { nutrient: { number: '208', name: 'Energy', unitName: 'KCAL' }, amount: 165 },
        { nutrient: { number: '203', name: 'Protein', unitName: 'G' }, amount: 31 },
      ],
    };
    expect(extractPer100g(detail)).toEqual({
      calories: 165,
      proteinG: 31,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('never reports a kilojoule figure as calories', () => {
    // Foundation foods carry energy in both units. Taking the kJ row would
    // overstate the food by ~4.2x.
    const food = {
      foodNutrients: [
        { nutrientNumber: '268', nutrientName: 'Energy', unitName: 'kJ', value: 2252 },
        { nutrientNumber: '208', nutrientName: 'Energy', unitName: 'KCAL', value: 539 },
      ],
    };
    expect(extractPer100g(food).calories).toBe(539);
  });

  it('falls back to a named kcal energy row when 208 is absent', () => {
    const food = {
      foodNutrients: [
        {
          nutrientNumber: '957',
          nutrientName: 'Energy (Atwater General Factors)',
          unitName: 'KCAL',
          value: 212,
        },
      ],
    };
    expect(extractPer100g(food).calories).toBe(212);
  });

  it('prefers 208 over the fallback when both are present', () => {
    const food = {
      foodNutrients: [
        { nutrientNumber: '957', nutrientName: 'Energy (Atwater)', unitName: 'KCAL', value: 212 },
        { nutrientNumber: '208', nutrientName: 'Energy', unitName: 'KCAL', value: 200 },
      ],
    };
    expect(extractPer100g(food).calories).toBe(200);
  });
});

describe('extractServings', () => {
  it('treats a millilitre label serving as grams', () => {
    const servings = extractServings({
      servingSize: 240,
      servingSizeUnit: 'ml',
      householdServingFullText: '1 cup',
    });
    expect(servings).toEqual([{ label: '1 cup', grams: 240 }]);
  });

  it('builds a label from the gram weight when no household text is given', () => {
    expect(extractServings({ servingSize: 28, servingSizeUnit: 'g' })).toEqual([
      { label: '28 g', grams: 28 },
    ]);
  });

  it('ignores a serving expressed in a unit it cannot weigh', () => {
    expect(extractServings({ servingSize: 2, servingSizeUnit: 'tbsp' })).toEqual([]);
  });

  it('reads foodPortions from a detail response', () => {
    // The only place household portions exist for Foundation/SR Legacy rows —
    // search returns foodMeasures: [] for every dataset.
    const servings = extractServings({
      foodPortions: [
        { amount: 1, gramWeight: 118, modifier: 'medium', portionDescription: '1 medium' },
        { amount: 1, gramWeight: 150, modifier: 'cup, sliced', measureUnit: { name: 'cup' } },
      ],
    });
    expect(servings).toEqual([
      { label: '1 medium', grams: 118 },
      { label: '1 cup', grams: 150 },
    ]);
  });

  it('divides a multi-unit portion down to one', () => {
    // "2 tbsp = 32 g" must become one tbsp = 16 g, or the picker's quantity
    // stepper counts in twos.
    const servings = extractServings({
      foodPortions: [{ amount: 2, gramWeight: 32, measureUnit: { name: 'tbsp' } }],
    });
    expect(servings).toEqual([{ label: '2 tbsp', grams: 16 }]);
  });

  it("treats FDC's 'undetermined' measure unit as no unit", () => {
    const servings = extractServings({
      foodPortions: [
        { amount: 1, gramWeight: 28, measureUnit: { name: 'undetermined' }, modifier: 'slice' },
      ],
    });
    expect(servings).toEqual([{ label: '1 slice', grams: 28 }]);
  });

  it('treats a missing or zero portion amount as one', () => {
    expect(
      extractServings({ foodPortions: [{ gramWeight: 85, modifier: 'fillet' }] })
    ).toEqual([{ label: '1 fillet', grams: 85 }]);
  });

  it('skips portions it cannot name or weigh', () => {
    expect(
      extractServings({
        foodPortions: [
          { amount: 1, gramWeight: 0, modifier: 'nothing' },
          { amount: 1, gramWeight: 50 },
        ],
      })
    ).toEqual([]);
  });

  it('skips foodMeasures with no weight or no label', () => {
    const servings = extractServings({
      foodMeasures: [
        { disseminationText: 'no weight', gramWeight: 0 },
        { gramWeight: 50 },
        { disseminationText: '1 slice', gramWeight: 28 },
      ],
    });
    expect(servings).toEqual([{ label: '1 slice', grams: 28 }]);
  });
});

describe('mapUsdaFood', () => {
  it('rejects a food with no description or no id', () => {
    expect(mapUsdaFood({ fdcId: 1 })).toBeNull();
    expect(mapUsdaFood({ description: 'Orphan' })).toBeNull();
  });
});

describe('mapOffProduct', () => {
  // offProduct.json is a live Open Food Facts response saved verbatim
  // (`npm run food:probe -- 0038000138416 --off` fetches the same thing).
  it('maps a product with its serving and brand', () => {
    expect(mapOffProduct(offProduct)).toEqual({
      source: 'off',
      sourceId: '0038000138416',
      name: 'Original Potato Crisps',
      brand: 'Pringles',
      barcode: '0038000138416',
      per100g: {
        calories: 535.714285714286,
        proteinG: 6.2,
        carbsG: 50,
        fatG: 31,
      },
      servings: [{ label: '1 serving (28 g)', grams: 28 }],
    });
  });

  it('reads kcal, not the kJ energy_100g key', () => {
    // This fixture is why the guard exists: the same product publishes
    // energy_100g = 2135.2 (kJ) alongside energy-kcal_100g = 535.7. Taking the
    // wrong key would report a serving of crisps as ~600 calories.
    expect(mapOffProduct(offProduct)?.per100g?.calories).toBeCloseTo(535.71, 2);
  });

  it('takes only the first of a comma-separated brand list', () => {
    // OFF accumulates every brand anyone has typed: "Nutella, Ferrero, Yum yum".
    const item = mapOffProduct({
      product: {
        code: '1',
        product_name: 'Spread',
        brands: 'Nutella, Ferrero, Yum yum',
        nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3 },
      },
    });
    expect(item?.brand).toBe('Nutella');
  });

  it('treats a product page with no nutrition as a miss', () => {
    // Common on Open Food Facts: the product exists and has a photo, but nobody
    // has entered the nutrition panel. That is a miss, not a zero-calorie food.
    expect(
      mapOffProduct({ product: { code: '123', product_name: 'Mystery snack', nutriments: {} } })
    ).toBeNull();
  });

  it('returns null for a not-found response', () => {
    expect(mapOffProduct({ status: 0, status_verbose: 'product not found' })).toBeNull();
    expect(mapOffProduct(null)).toBeNull();
  });

  it('omits the serving when no gram quantity is published', () => {
    const item = mapOffProduct({
      product: {
        code: '5',
        product_name: 'Loose tea',
        serving_size: 'a pinch',
        nutriments: { 'energy-kcal_100g': 1, proteins_100g: 0 },
      },
    });
    expect(item?.servings).toEqual([]);
  });
});

describe('ingestFoodItems', () => {
  it('passes clean items through', () => {
    const items = ingestFoodItems([
      {
        source: 'usda',
        sourceId: '1',
        name: 'Oats',
        per100g: { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 },
        servings: [{ label: '1 cup', grams: 81 }],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].servings).toEqual([{ label: '1 cup', grams: 81 }]);
  });

  it('rejects NaN and missing macros rather than storing them in a diary', () => {
    expect(
      ingestFoodItems([
        { source: 'usda', sourceId: '1', name: 'Broken', per100g: { calories: 'x', proteinG: null } },
      ])
    ).toEqual([]);
  });

  it('rejects unknown sources and nameless rows', () => {
    expect(
      ingestFoodItems([
        { source: 'hacked', sourceId: '1', name: 'X', per100g: { calories: 10 } },
        { source: 'usda', name: '', per100g: { calories: 10 } },
      ])
    ).toEqual([]);
  });

  it('drops junk servings but keeps the item', () => {
    const items = ingestFoodItems([
      {
        source: 'off',
        sourceId: '2',
        name: 'Bar',
        per100g: { calories: 400, proteinG: 20, carbsG: 40, fatG: 12 },
        servings: [{ label: 'bar', grams: 0 }, { label: '', grams: 50 }, 'nope'],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].servings).toEqual([]);
  });

  it('survives non-array input', () => {
    expect(ingestFoodItems(undefined)).toEqual([]);
    expect(ingestFoodItems({ foods: [] })).toEqual([]);
  });
});
