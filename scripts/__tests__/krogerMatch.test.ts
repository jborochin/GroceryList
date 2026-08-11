import {
  MIN_CONFIDENCE,
  descriptionSpecificity,
  median,
  parseSize,
  pickMedianBy,
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

  // Live regression: "cornstarch" matched a cornstarch-based baby powder, not
  // the cooking ingredient. A bare "baby" trap token would also reject "Baby
  // Carrots" — an ordinary, extremely common real SKU — so this is a
  // phrase-pair veto (baby AND powder together), not a single trap word.
  it('rejects non-food personal-care products via phrase pairs', () => {
    expect(scoreMatch('cornstarch', 'Comforts™ Fresh Scent Pure Cornstarch Baby Powder')).toBe(0);
  });

  it('does not veto ordinary "baby" produce SKUs (only "baby powder" together)', () => {
    expect(scoreMatch('carrot', 'Private Selection Baby Carrots with Onion Dip')).toBe(1);
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

  // Live regression: these matched the search term perfectly and priced inside
  // the sanity band because the product is a snack/cured good that happens to
  // contain the ingredient word, not the ingredient itself.
  it('rejects snack/cured products containing the ingredient word', () => {
    expect(scoreMatch('banana', 'Simple Truth Berries and Banana Trail Mix')).toBe(0);
    expect(scoreMatch('fennel', 'Brooklyn Cured Finocchiona Fennel Salami')).toBe(0);
    expect(scoreMatch('chickpea', 'Simple Truth Baked Chickpea Crisps')).toBe(0);
    expect(scoreMatch('potato', 'Kettle Cooked Potato Chips')).toBe(0);
    expect(scoreMatch('cheddar cheese', 'Cheddar Cheese Crackers')).toBe(0);
  });

  it('still accepts frozen forms of those ingredients (not vetoed)', () => {
    expect(scoreMatch('edamame', 'Frozen Shelled Edamame')).toBe(1);
    expect(scoreMatch('stir-fry vegetable', 'Frozen Stir-Fry Vegetable Blend')).not.toBe(0);
  });

  // Live regression: "apricot" matched "Private Selection Apricot Preserves"
  // (a cooked fruit spread, not fresh fruit) — perfect token match, healthy
  // candidate pool, inside the sanity band. Only an explicit veto catches it.
  it('rejects fruit preserves/jam/jelly for the fresh-fruit ingredient', () => {
    expect(scoreMatch('apricot', 'Private Selection® Apricot Preserves')).toBe(0);
    expect(scoreMatch('strawberry', "Smucker's Strawberry Jam")).toBe(0);
    expect(scoreMatch('grape', "Welch's Grape Jelly")).toBe(0);
    expect(scoreMatch('orange', 'Kroger Orange Marmalade')).toBe(0);
  });

  it('still accepts the fresh fruit itself', () => {
    expect(scoreMatch('apricot', 'Fresh Apricots')).toBe(1);
  });

  // Live regression: after the preserves fix, "apricot"'s candidate pool was
  // still dominated by dried-fruit SKUs (dried fruit runs 3-4x pricier per lb
  // than fresh), and the median landed on "Kroger Probiotic Dried Apricots"
  // at $11.17/lb instead of ~$4/lb fresh. A bare "dried" trap would also
  // reject "raisin"'s own correct match ("Sun-Dried Raisins" — a raisin IS a
  // dried grape), so this needs an allowlist exception.
  it('rejects dried-fruit products for fresh-fruit ingredients', () => {
    expect(scoreMatch('apricot', 'Kroger® Probiotic Dried Apricots')).toBe(0);
    expect(scoreMatch('apricot', 'Mariani® Premium Mediterranean Dried Apricots')).toBe(0);
    expect(scoreMatch('blueberry', 'Simple Truth Organic Dried Blueberries')).toBe(0);
  });

  it('still accepts "raisin" matching a dried-grape product (allowlisted)', () => {
    expect(scoreMatch('raisin', 'Sun-Maid® California Sun-Dried Raisins')).toBe(1);
  });

  // Live regression: a mixed-vegetable bag names several vegetables plus a
  // "Blend"/"Medley" suffix, so a single-word search term for one of them
  // clears the head-noun check against the whole product, not just its share.
  it('rejects multi-vegetable blends that merely mention the ingredient', () => {
    expect(
      scoreMatch('zucchini', 'Pictsweet Farms Red Potatoes Carrots Onions & Zucchini Blend')
    ).toBe(0);
    expect(scoreMatch('carrot', 'Birds Eye Carrot Pea Corn Medley')).toBe(0);
  });

  // Live regression: the actual Kroger match had no "Blend"/"Medley" word at
  // all, so only the BLEND_TOKENS veto above would have missed it. This is
  // the exact title observed — caught by the co-occurring-known-ingredient
  // check instead (potato + carrot + onion all separately price in the app).
  it('rejects an unlabeled vegetable mix via co-occurring known ingredients', () => {
    expect(
      scoreMatch(
        'zucchini',
        'Pictsweet Farms® Red Potatoes Carrots Onions Zucchini Frozen Vegetables'
      )
    ).toBe(0);
  });

  // Live regression: a product commonly names one or two of its OWN
  // ingredients in the title without being a multi-item bag ("Oats and
  // Honey Granola", "Quinoa & Brown Rice with Garlic"). Only >=3 co-occurring
  // known ingredients — a genuine multi-item bag, not seasoning/composition —
  // trips the veto.
  it('does not veto a single-ingredient SKU naming one or two of its own ingredients', () => {
    expect(scoreMatch('carrot', 'Private Selection Baby Carrots with Onion Dip')).toBe(1);
    expect(scoreMatch('granola', 'Cascadian Farm Organic Oats and Honey Granola Cereal')).toBe(1);
    expect(scoreMatch('quinoa', 'Seeds of Change Organic Quinoa & Brown Rice with Garlic')).toBe(1);
  });

  it('still accepts the plain form of blended ingredients', () => {
    expect(scoreMatch('zucchini', 'Fresh Zucchini')).toBe(1);
    expect(scoreMatch('carrot', 'Fresh Whole Carrots, 1 lb Bag')).toBe(1);
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

describe('pickMedianBy', () => {
  const pool = (...prices: number[]) => prices.map((p, i) => ({ p, len: i }));
  const pick = (items: { p: number; len: number }[]) =>
    pickMedianBy(items, (c) => c.p, (c) => c.len)?.p;

  it('picks the middle price for odd pools', () => {
    expect(pick(pool(5, 1, 3))).toBe(3);
  });

  // Leaning to the lower middle keeps the estimate conservative rather than premium.
  it('picks the lower middle for even pools', () => {
    expect(pick(pool(1, 2, 3, 4))).toBe(2);
  });

  it('does not pick the cheapest or the most expensive', () => {
    const chosen = pick(pool(2.89, 3.49, 4.99, 6.29, 9.99));
    expect(chosen).toBe(4.99);
  });

  it('breaks price ties on the secondary value', () => {
    const items = [
      { p: 3, len: 9, id: 'verbose' },
      { p: 3, len: 2, id: 'plain' },
    ];
    expect(pickMedianBy(items, (c) => c.p, (c) => c.len)?.id).toBe('plain');
  });

  it('handles single-candidate pools and empty pools', () => {
    expect(pick(pool(4.25))).toBe(4.25);
    expect(pickMedianBy([], () => 0, () => 0)).toBeNull();
  });

  it('does not mutate the input', () => {
    const items = pool(5, 1, 3);
    pick(items);
    expect(items.map((i) => i.p)).toEqual([5, 1, 3]);
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
