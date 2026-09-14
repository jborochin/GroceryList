import { parseIngredient, splitGluedUnits } from '../utils/ingredientParser';

describe('parseIngredient', () => {
  it('parses simple integer with unit', () => {
    const r = parseIngredient('2 cups flour');
    expect(r).toMatchObject({ quantity: 2, unit: 'cup', name: 'flour' });
  });

  it('parses decimal quantity', () => {
    const r = parseIngredient('1.5 cups milk');
    expect(r).toMatchObject({ quantity: 1.5, unit: 'cup', name: 'milk' });
  });

  it('parses simple fraction', () => {
    const r = parseIngredient('1/2 tsp salt');
    expect(r.quantity).toBeCloseTo(0.5, 5);
    expect(r.unit).toBe('tsp');
    expect(r.name).toBe('salt');
  });

  it('parses mixed fraction', () => {
    const r = parseIngredient('1 1/2 cups milk');
    expect(r.quantity).toBeCloseTo(1.5, 5);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('milk');
  });

  it('parses unicode half fraction', () => {
    const r = parseIngredient('½ tsp salt');
    expect(r.quantity).toBeCloseTo(0.5, 5);
    expect(r.unit).toBe('tsp');
    expect(r.name).toBe('salt');
  });

  it('parses 1½ as 1.5', () => {
    const r = parseIngredient('1½ cups flour');
    expect(r.quantity).toBeCloseTo(1.5, 5);
    expect(r.unit).toBe('cup');
  });

  it('strips parenthetical notes', () => {
    const r = parseIngredient('1 (14-ounce) can diced tomatoes');
    expect(r.quantity).toBe(1);
    expect(r.unit).toBe('can');
    expect(r.name).toBe('diced tomatoes');
  });

  it('strips nested parentheticals without leaving a dangling bracket', () => {
    const r = parseIngredient('2 cups chocolate chips (such as Nestle (semi-sweet))');
    expect(r.name).toBe('chocolate chips');
  });

  it('strips orphan closing paren', () => {
    const r = parseIngredient('1 cup chocolate chips)');
    expect(r.name).toBe('chocolate chips');
  });

  it('handles two-word unit (fl oz)', () => {
    const r = parseIngredient('8 fl oz orange juice');
    expect(r.quantity).toBe(8);
    expect(r.unit).toBe('fl_oz');
    expect(r.name).toBe('orange juice');
  });

  it('handles "of" separator', () => {
    const r = parseIngredient('1 cup of sugar');
    expect(r.quantity).toBe(1);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('sugar');
  });

  it('drops "to taste" tail', () => {
    const r = parseIngredient('salt to taste');
    expect(r.name).toBe('salt');
  });

  it('drops ", to taste" tail with comma', () => {
    const r = parseIngredient('salt, to taste');
    expect(r.name).toBe('salt');
  });

  it('does not mangle names that merely end in "taste"', () => {
    const r = parseIngredient('1 tbsp tomato paste');
    expect(r.name).toBe('tomato paste');
  });

  it('averages hyphen ranges', () => {
    const r = parseIngredient('1-2 cups flour');
    expect(r.quantity).toBeCloseTo(1.5, 5);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('flour');
  });

  it('averages spaced en-dash ranges', () => {
    const r = parseIngredient('1 – 2 cups flour');
    expect(r.quantity).toBeCloseTo(1.5, 5);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('flour');
  });

  it('averages "X to Y" word ranges', () => {
    const r = parseIngredient('3 to 4 tbsp olive oil');
    expect(r.quantity).toBeCloseTo(3.5, 5);
    expect(r.unit).toBe('tbsp');
    expect(r.name).toBe('olive oil');
  });

  it('averages fraction ranges', () => {
    const r = parseIngredient('1/2-3/4 tsp cumin');
    expect(r.quantity).toBeCloseTo(0.625, 5);
    expect(r.unit).toBe('tsp');
    expect(r.name).toBe('cumin');
  });

  it('defaults unit to each when none present', () => {
    const r = parseIngredient('3 eggs');
    expect(r.quantity).toBe(3);
    expect(r.unit).toBe('each');
    expect(r.name).toBe('eggs');
  });

  it('handles tbsp alias', () => {
    const r = parseIngredient('2 tablespoons olive oil');
    expect(r.unit).toBe('tbsp');
    expect(r.name).toBe('olive oil');
  });

  it('tolerates trailing period on unit', () => {
    const r = parseIngredient('2 tbsp. olive oil');
    expect(r.unit).toBe('tbsp');
    expect(r.name).toBe('olive oil');
  });

  it('stores raw string', () => {
    const r = parseIngredient('2 cups flour');
    expect(r.raw).toBe('2 cups flour');
  });

  // Instagram captions glue quantity to unit. Before this was handled, every one
  // of these fell through as `1 each :: "300g pasta"` — no quantity, no unit, and
  // therefore no aggregation or pricing downstream.
  describe('glued quantity+unit (Instagram caption style)', () => {
    it('splits a metric weight from its unit', () => {
      expect(parseIngredient('300g pasta')).toMatchObject({
        quantity: 300,
        unit: 'g',
        name: 'pasta',
      });
    });

    it('splits a metric volume from its unit', () => {
      expect(parseIngredient('300ml chicken stock')).toMatchObject({
        quantity: 300,
        unit: 'ml',
        name: 'chicken stock',
      });
    });

    it('resolves the "tbs" spelling that captions favour', () => {
      expect(parseIngredient('1tbs smoked paprika')).toMatchObject({
        quantity: 1,
        unit: 'tbsp',
        name: 'smoked paprika',
      });
    });

    it('handles a glued fraction', () => {
      const r = parseIngredient('1/2tbs oregano');
      expect(r.quantity).toBeCloseTo(0.5, 5);
      expect(r.unit).toBe('tbsp');
      expect(r.name).toBe('oregano');
    });

    it('handles a glued teaspoon', () => {
      expect(parseIngredient('2tsp garlic puree')).toMatchObject({
        quantity: 2,
        unit: 'tsp',
        name: 'garlic puree',
      });
    });

    it('splits a glued count unit', () => {
      expect(parseIngredient('3cloves garlic')).toMatchObject({
        quantity: 3,
        unit: 'clove',
        name: 'garlic',
      });
    });
  });

  // The split is gated on the letter run being a real unit alias. These all carry
  // a digit followed by letters and must survive untouched.
  describe('deglue guard', () => {
    it.each([
      ['9x13 pan', '9x13 pan'],
      ['7up', '7up'],
      ['bake at 350f', 'bake at 350f'],
      ['1st layer of noodles', '1st layer of noodles'],
      ['2 1/2 cups flour', '2 1/2 cups flour'],
      ['300 g pasta', '300 g pasta'],
    ])('leaves %s alone', (input, expected) => {
      expect(splitGluedUnits(input)).toBe(expected);
    });

    it('keeps a non-unit suffix out of the quantity', () => {
      // "7up" must stay a name, not become quantity 7.
      expect(parseIngredient('7up')).toMatchObject({ name: '7up', unit: 'each' });
    });
  });
});

describe('parseIngredient — mixed numbers next to ranges', () => {
  it('reads "1 1/2-2" as the range 1.5..2, not 1 + (0.5..2)', () => {
    const r = parseIngredient('1 1/2-2 cups flour');
    expect(r.quantity).toBeCloseTo(1.75, 5);
    expect(r).toMatchObject({ unit: 'cup', name: 'flour' });
  });

  it('agrees with the spelled-out form', () => {
    expect(parseIngredient('1 1/2-2 cups flour').quantity).toBeCloseTo(
      parseIngredient('1 1/2 to 2 cups flour').quantity,
      5
    );
  });

  it('reads "1-1 1/2" as the range 1..1.5', () => {
    const r = parseIngredient('1-1 1/2 cups flour');
    expect(r.quantity).toBeCloseTo(1.25, 5);
    expect(r).toMatchObject({ unit: 'cup', name: 'flour' });
  });
});

describe('parseIngredient — leading articles', () => {
  it('reads "a pinch of salt" as 1 pinch of salt, not an ingredient named "pinch salt"', () => {
    expect(parseIngredient('a pinch of salt')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'salt' });
  });

  it('reads "a clove of garlic" with the unit', () => {
    expect(parseIngredient('a clove of garlic')).toMatchObject({ quantity: 1, unit: 'clove', name: 'garlic' });
  });

  it('reads "an onion" as one each', () => {
    expect(parseIngredient('an onion')).toMatchObject({ quantity: 1, unit: 'each', name: 'onion' });
  });

  it('still strips "the" without inventing a unit', () => {
    const r = parseIngredient('the zest of 1 lemon');
    expect(r).toMatchObject({ quantity: 1, unit: 'each' });
    expect(r.name).toMatch(/^zest\b.*lemon$/);
  });
});

describe('prototype-safe lookups', () => {
  it('treats Object.prototype member names as ordinary text', () => {
    const { canonicalizeUnit } = require('../utils/ingredientParser');
    const { normalizeName } = require('../utils/normalizeName');
    expect(canonicalizeUnit('constructor')).toBe('constructor');
    expect(canonicalizeUnit('toString')).toBe('tostring');
    expect(normalizeName('constructor')).toBe('constructor');
    expect(normalizeName('hasOwnProperty')).toBe('hasownproperty');
    expect(parseIngredient('2 constructor apples')).toMatchObject({ quantity: 2, unit: 'each' });
  });
});
