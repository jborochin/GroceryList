import { estimatePriceForItem, findPrice } from '../utils/priceEstimator';
import { GroceryItem } from '../types';

function item(name: string, qty: number, unit: string): GroceryItem {
  return {
    name,
    displayName: name,
    category: 'Other',
    entries: [{ quantity: qty, unit }],
    hasPriceGap: false,
  };
}

describe('priceEstimator', () => {
  it('finds price for exact-matching ingredient', () => {
    const p = findPrice('chicken breast');
    expect(p).not.toBeNull();
    expect(p?.unit).toBe('lb');
  });

  it('returns null for unknown ingredient', () => {
    const p = findPrice('unobtainium-7');
    expect(p).toBeNull();
  });

  // Uses 'tofu' rather than 'chicken breast' deliberately: tofu's price is a
  // fixed hand-estimate in priceDatabase.json, while chicken breast is one of
  // the 13 keys scripts/refreshBlsPrices.ts overwrites from live BLS data, so
  // hardcoding an expected dollar amount against it would break every refresh.
  it('estimates price via unit conversion', () => {
    const priced = estimatePriceForItem(item('tofu', 2, 'lb'));
    expect(priced.estimatedPrice).toBeCloseTo(6.0, 1);
    expect(priced.hasPriceGap).toBe(false);
  });

  it('converts oz → lb when computing', () => {
    const priced = estimatePriceForItem(item('tofu', 16, 'oz'));
    expect(priced.estimatedPrice).toBeCloseTo(3.0, 1);
  });

  it('uses overrides when present', () => {
    const priced = estimatePriceForItem(
      item('chicken breast', 1, 'lb'),
      { 'chicken breast': { name: 'chicken breast', pricePerUnit: 99, unit: 'lb' } }
    );
    expect(priced.estimatedPrice).toBeCloseTo(99, 5);
  });

  it('flags no-match items', () => {
    const priced = estimatePriceForItem(item('dragonfruit', 1, 'each'));
    expect(priced.estimatedPrice).toBeUndefined();
    expect(priced.hasPriceGap).toBe(true);
  });

  it('prices a cross-family purchase unit via the profile bridge (broccoli head → lb)', () => {
    // Previously a unit-conflict gap; now bridged through the broccoli profile's grams.
    const priced = estimatePriceForItem(item('broccoli', 1, 'head'));
    expect(priced.hasPriceGap).toBe(false);
    expect(priced.estimatedPrice).toBeCloseTo((400 / 453.592) * 2.0, 2);
  });
});
