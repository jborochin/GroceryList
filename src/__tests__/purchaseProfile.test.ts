import { getProfile, convertMeasure, PurchaseProfile } from '../utils/purchaseProfile';

describe('convertMeasure', () => {
  it('returns qty for identical units', () => {
    expect(convertMeasure(3, 'each', 'each', null)).toBe(3);
  });

  it('delegates to convert() within a family (no profile needed)', () => {
    expect(convertMeasure(1, 'tbsp', 'tsp', null)).toBeCloseTo(3, 5);
    expect(convertMeasure(16, 'oz', 'lb', null)).toBeCloseTo(1, 5);
  });

  it('bridges count↔count via grams (garlic clove → head)', () => {
    const p: PurchaseProfile = { sellUnit: 'head', packSize: 1, grams: { clove: 5, head: 50 } };
    expect(convertMeasure(2, 'clove', 'head', p)).toBeCloseTo(0.2, 5); // 10g / 50g
  });

  it('bridges volume↔count via grams (broccoli cup → head)', () => {
    const p: PurchaseProfile = { sellUnit: 'head', packSize: 1, grams: { cup: 90, head: 400 } };
    expect(convertMeasure(1, 'cup', 'head', p)).toBeCloseTo(0.225, 5); // 90g / 400g
  });

  it('bridges weight↔count using universal mass + one gram anchor (cheese oz → block)', () => {
    const p: PurchaseProfile = { sellUnit: 'block', packSize: 1, grams: { block: 227 } };
    expect(convertMeasure(16, 'oz', 'block', p)).toBeCloseTo(453.592 / 227, 3);
  });

  it('bridges count↔weight for pricing (broccoli head → lb)', () => {
    const p: PurchaseProfile = { sellUnit: 'head', packSize: 1, grams: { cup: 90, head: 400 } };
    expect(convertMeasure(1, 'head', 'lb', p)).toBeCloseTo(400 / 453.592, 4);
  });

  it('reaches an unlisted volume unit through a volume anchor (oil tbsp → bottle)', () => {
    const p: PurchaseProfile = { sellUnit: 'bottle', packSize: 1, grams: { cup: 160, bottle: 480 } };
    // 1 tbsp = 1/16 cup = 10g; 10 / 480 bottle
    expect(convertMeasure(1, 'tbsp', 'bottle', p)).toBeCloseTo(10 / 480, 5);
  });

  it('returns null when families differ and grams cannot bridge', () => {
    expect(convertMeasure(1, 'cup', 'each', { sellUnit: 'each', packSize: 1 })).toBeNull();
    expect(convertMeasure(1, 'cup', 'each', null)).toBeNull();
  });
});

describe('getProfile', () => {
  it('returns an explicit profile for a cross-unit item', () => {
    const p = getProfile('garlic');
    expect(p).not.toBeNull();
    expect(p?.sellUnit).toBe('head');
    expect(p?.grams?.clove).toBeGreaterThan(0);
  });

  it('derives a default profile from the price entry when none is authored', () => {
    // avocado is priced "each" and has no need for an explicit profile
    const avocado = getProfile('avocado');
    expect(avocado?.sellUnit).toBe('each');
    expect(avocado?.packSize).toBe(1);
    // chicken breast is priced per lb (weight) → sell unit lb
    expect(getProfile('chicken breast')?.sellUnit).toBe('lb');
  });

  it('resolves through name normalization (plural / fuzzy like findPrice)', () => {
    expect(getProfile('Broccoli')?.sellUnit).toBe('head');
  });

  it('returns null for an unknown ingredient with no price', () => {
    expect(getProfile('unobtainium-7')).toBeNull();
  });
});
