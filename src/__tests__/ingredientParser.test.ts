import { parseIngredient } from '../utils/ingredientParser';

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
});
