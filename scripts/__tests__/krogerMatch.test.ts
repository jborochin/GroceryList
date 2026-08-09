import {
  MIN_CONFIDENCE,
  descriptionSpecificity,
  median,
  parseSize,
  sanityBand,
  scoreMatch,
} from '../lib/krogerMatch';

describe('parseSize', () => {
  it('parses plain weight and volume sizes', () => {
    expect(parseSize('16 oz')).toEqual({ qty: 16, unit: 'oz' });
    expect(parseSize('1 lb')).toEqual({ qty: 1, unit: 'lb' });
    expect(parseSize('0.5 gal')).toEqual({ qty: 0.5, unit: 'gallon' });
    expect(parseSize('1 pt')).toEqual({ qty: 1, unit: 'pint' });
  });

  it('prefers the two-word "fl oz" over a bare leading token', () => {
    expect(parseSize('64 fl oz')).toEqual({ qty: 64, unit: 'fl_oz' });
  });

  it('maps count tokens onto the canonical `each` unit', () => {
    expect(parseSize('12 ct')).toEqual({ qty: 12, unit: 'each' });
    expect(parseSize('1 count')).toEqual({ qty: 1, unit: 'each' });
    expect(parseSize('each')).toEqual({ qty: 1, unit: 'each' });
  });

  it('expands dozen into a count', () => {
    expect(parseSize('dozen')).toEqual({ qty: 12, unit: 'each' });
    expect(parseSize('2 dozen')).toEqual({ qty: 24, unit: 'each' });
  });

  it('multiplies out multipack sizes', () => {
    expect(parseSize('6 x 12 oz')).toEqual({ qty: 72, unit: 'oz' });
  });

  it('tolerates packaging nouns after the unit', () => {
    expect(parseSize('5 lb bag')).toEqual({ qty: 5, unit: 'lb' });
    expect(parseSize('16 oz can')).toEqual({ qty: 16, unit: 'oz' });
  });

  it('is case and whitespace insensitive', () => {
    expect(parseSize('  16 OZ  ')).toEqual({ qty: 16, unit: 'oz' });
  });

  // A misparsed pack size scales the price silently, so anything ambiguous must
  // be refused rather than guessed at.
  it('refuses ambiguous or unparseable sizes', () => {
    expect(parseSize('Pack of 6')).toBeNull();
    expect(parseSize('Case')).toBeNull();
    expect(parseSize('approx 2 lb')).toBeNull();
    expect(parseSize('1 lb 4 oz')).toBeNull();
    expect(parseSize('large')).toBeNull();
    expect(parseSize('')).toBeNull();
    expect(parseSize(null)).toBeNull();
  });

  it('rejects unit tokens the app has no canonical unit for', () => {
    expect(parseSize('3 sleeve')).toBeNull();
  });

  it('accepts a pluralized unit token', () => {
    // Observed live: Gold Medal flour reports "5 lbs".
    expect(parseSize('5 lbs')).toEqual({ qty: 5, unit: 'lb' });
  });

  // Retail uses "count / measure" for both "N items totalling M" and "N items
  // of M each". Nothing in the string distinguishes them and guessing wrong is
  // a 6-8x error, so these are refused. All three shapes are live-observed.
  it('refuses composite count/measure sizes', () => {
    expect(parseSize('8 ct / 30.4 ounce')).toBeNull();
    expect(parseSize('4 sticks / 16 oz')).toBeNull();
    expect(parseSize('10 ct / 17.5 oz')).toBeNull();
  });
});

describe('scoreMatch', () => {
  it('scores a fully matched multi-word term at 1', () => {
    expect(scoreMatch('cheddar cheese', 'Kroger Sharp Cheddar Cheese Block, 8 oz')).toBe(1);
  });

  it('scores a partial match below 1 but above the publish threshold', () => {
    const score = scoreMatch('chicken breast', 'Boneless Skinless Breast Fillets');
    expect(score).toBeCloseTo(0.5);
    expect(score).toBeLessThan(MIN_CONFIDENCE);
  });

  // The head-noun rule is what stops a search for "chicken" landing on broth.
  it('requires the head noun to be present', () => {
    expect(scoreMatch('chicken', 'Kroger Chicken Broth, 32 fl oz')).toBe(1);
    expect(scoreMatch('chicken breast', 'Kroger Chicken Broth, 32 fl oz')).toBe(0);
  });

  it('rejects trap SKUs outright', () => {
    expect(scoreMatch('chicken', 'Purina Dog Chow Chicken Recipe')).toBe(0);
    expect(scoreMatch('rice', 'Chicken Flavored Rice Mix')).toBe(0);
    expect(scoreMatch('lemon', 'Lemon Scented Dish Soap')).toBe(0);
  });

  // Only reject a trap word when the caller did not ask for it.
  it('does not reject when the trap token is part of the search term', () => {
    expect(scoreMatch('vitamin d milk', 'Kroger Vitamin D Whole Milk, 1 gal')).toBe(1);
  });

  it('returns 0 for empty input', () => {
    expect(scoreMatch('rice', '')).toBe(0);
    expect(scoreMatch('rice', null)).toBe(0);
    expect(scoreMatch('', 'Kroger Rice')).toBe(0);
  });

  // Live regression: without singularization "tortilla" found no candidate at
  // all, because every SKU is described as "Tortillas".
  it('matches across singular/plural', () => {
    expect(scoreMatch('tortilla', 'Kroger® Soft Taco Size Flour Tortillas')).toBe(1);
    expect(scoreMatch('banana', 'Fresh Bunch of Bananas')).toBe(1);
  });

  // Live regression: these match the search term perfectly and price inside the
  // sanity band, so only an explicit veto keeps them out.
  it('rejects prepared forms of a whole ingredient', () => {
    expect(scoreMatch('chicken breast', 'Kroger® Chicken Breast Deli Thin Sliced')).toBe(0);
    expect(scoreMatch('banana', 'Naked Boosted Smoothie Strawberry Banana Machine')).toBe(0);
    expect(scoreMatch('ground beef', 'Kroger® 80/20 Ground Beef Patties')).toBe(0);
  });

  it('still accepts the plain form of those ingredients', () => {
    expect(scoreMatch('chicken breast', 'Heritage Farm® Boneless Skinless Chicken Breast')).toBe(1);
  });
});

describe('descriptionSpecificity', () => {
  // Tie-breaker only: among equally-scoring candidates the plainer description
  // is the better stand-in for a recipe ingredient.
  it('ranks a plain description below a padded one', () => {
    expect(descriptionSpecificity('Broccoli Crown')).toBeLessThan(
      descriptionSpecificity('Private Selection® Premium Steamed Broccoli Florets Blend')
    );
  });

  it('sorts missing descriptions last', () => {
    expect(descriptionSpecificity(null)).toBeGreaterThan(descriptionSpecificity('Garlic'));
  });
});

describe('sanityBand', () => {
  it('accepts prices near the baseline', () => {
    expect(sanityBand(4.5, 4.18, false)).toBe(true);
    expect(sanityBand(2.0, 4.18, false)).toBe(true);
  });

  it('rejects unreviewed outliers outside 0.25x-4x', () => {
    expect(sanityBand(0.5, 4.18, false)).toBe(false);
    expect(sanityBand(40, 4.18, false)).toBe(false);
  });

  it('gives reviewed mappings a wider band', () => {
    expect(sanityBand(40, 4.18, true)).toBe(true);
    expect(sanityBand(0.5, 4.18, true)).toBe(true);
    expect(sanityBand(500, 4.18, true)).toBe(false);
  });

  it('is inclusive at the band edges', () => {
    expect(sanityBand(4, 1, false)).toBe(true);
    expect(sanityBand(0.25, 1, false)).toBe(true);
    expect(sanityBand(4.01, 1, false)).toBe(false);
  });

  it('rejects non-positive or non-finite inputs', () => {
    expect(sanityBand(0, 4.18, false)).toBe(false);
    expect(sanityBand(-1, 4.18, false)).toBe(false);
    expect(sanityBand(Number.NaN, 4.18, false)).toBe(false);
    expect(sanityBand(4.18, 0, false)).toBe(false);
  });
});

describe('median', () => {
  it('returns the middle value for odd counts', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for even counts', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  // A store that returns no price for an item must not drag the median to zero.
  it('ignores non-positive and non-finite values', () => {
    expect(median([0, 4, 6])).toBe(5);
    expect(median([Number.NaN, 2])).toBe(2);
  });

  it('returns null when nothing is usable', () => {
    expect(median([])).toBeNull();
    expect(median([0, -1])).toBeNull();
  });
});
