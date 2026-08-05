import { formatQuantity, ingredientToNutritionQuery } from '../utils/nutritionQuery';
import { Ingredient } from '../types';

const ing = (over: Partial<Ingredient>): Ingredient => ({
  name: 'thing',
  quantity: 1,
  unit: 'each',
  ...over,
});

describe('formatQuantity — decimals become CalorieNinjas-safe fractions', () => {
  it('renders whole numbers as integers', () => {
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(5)).toBe('5');
  });

  it('snaps decimal fractions to common cooking fractions', () => {
    expect(formatQuantity(0.25)).toBe('1/4');
    expect(formatQuantity(0.5)).toBe('1/2');
    expect(formatQuantity(0.75)).toBe('3/4');
    expect(formatQuantity(1 / 3)).toBe('1/3');
    expect(formatQuantity(2 / 3)).toBe('2/3');
    expect(formatQuantity(0.125)).toBe('1/8');
  });

  it('renders mixed numbers (the cases that broke CalorieNinjas)', () => {
    expect(formatQuantity(1.5)).toBe('1 1/2');
    expect(formatQuantity(2.5)).toBe('2 1/2');
    expect(formatQuantity(1.25)).toBe('1 1/4');
  });

  it('snaps near-fraction noise to the closest clean fraction', () => {
    expect(formatQuantity(0.33)).toBe('1/3');
    expect(formatQuantity(0.26)).toBe('1/4');
  });

  it('rounds a fraction near 1 up into the whole part', () => {
    expect(formatQuantity(1.95)).toBe('2');
  });

  it('never emits a decimal point', () => {
    for (const q of [0.1, 0.25, 0.4, 0.6, 0.9, 1.1, 1.5, 2.7, 3.33]) {
      expect(formatQuantity(q)).not.toMatch(/\./);
    }
  });

  it('returns empty for non-positive quantities', () => {
    expect(formatQuantity(0)).toBe('');
    expect(formatQuantity(-1)).toBe('');
    expect(formatQuantity(NaN)).toBe('');
  });
});

describe('ingredientToNutritionQuery', () => {
  it('omits the "each" count unit', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'eggs', quantity: 2, unit: 'each' }))).toBe(
      '2 eggs',
    );
  });

  it('keeps real measure units and fraction-formats the quantity', () => {
    expect(
      ingredientToNutritionQuery(ing({ name: 'feta cheese', quantity: 0.25, unit: 'cup' })),
    ).toBe('1/4 cup feta cheese');
    expect(
      ingredientToNutritionQuery(ing({ name: 'rice', quantity: 1.5, unit: 'cup' })),
    ).toBe('1 1/2 cup rice');
  });

  it('truncates embedded-comma prep descriptors', () => {
    expect(
      ingredientToNutritionQuery(
        ing({ name: 'small potatoes, thinly sliced', quantity: 2.5, unit: 'each' }),
      ),
    ).toBe('2 1/2 potatoes');
  });

  it('expands recipe shorthand', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'evoo', quantity: 1, unit: 'each' }))).toBe(
      '1 olive oil',
    );
  });

  it('drops unknown count units so the food noun stands alone', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'garlic', quantity: 1, unit: 'clove' }))).toBe(
      '1 garlic',
    );
  });

  it('strips leading prep/quality descriptors but keeps the food noun', () => {
    expect(
      ingredientToNutritionQuery(
        ing({ name: 'hard boiled pasture-raised eggs', quantity: 2.5, unit: 'each' }),
      ),
    ).toBe('2 1/2 eggs');
    expect(
      ingredientToNutritionQuery(ing({ name: 'small potatoes', quantity: 2, unit: 'each' })),
    ).toBe('2 potatoes');
    expect(
      ingredientToNutritionQuery(ing({ name: 'crumbled feta', quantity: 1, unit: 'each' })),
    ).toBe('1 feta');
  });

  it('keeps food-defining modifiers', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'cherry tomatoes', quantity: 5, unit: 'each' }))).toBe(
      '5 cherry tomatoes',
    );
    expect(ingredientToNutritionQuery(ing({ name: 'green onion', quantity: 1, unit: 'each' }))).toBe(
      '1 green onion',
    );
  });

  it('does not strip a name made entirely of descriptors', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'chopped', quantity: 1, unit: 'each' }))).toBe(
      '1 chopped',
    );
  });

  it('returns the bare name when quantity is unusable', () => {
    expect(ingredientToNutritionQuery(ing({ name: 'feta cheese', quantity: 0, unit: 'each' }))).toBe(
      'feta cheese',
    );
  });

  it('strips leading comma-separated descriptors, keeping the food noun', () => {
    expect(
      ingredientToNutritionQuery(
        ing({ name: 'boneless, skinless chicken breast', quantity: 1.5, unit: 'lb' }),
      ),
    ).toBe('1 1/2 lb chicken breast');
  });

  it('returns empty when there is no food name', () => {
    expect(ingredientToNutritionQuery(ing({ name: '', quantity: 1, unit: 'each' }))).toBe('');
  });
});
