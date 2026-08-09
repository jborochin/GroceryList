import {
  MIN_CONFIDENCE,
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
