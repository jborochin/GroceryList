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

  it('estimates price via unit conversion', () => {
    const priced = estimatePriceForItem(item('chicken breast', 2, 'lb'));
    expect(priced.estimatedPrice).toBeCloseTo(9.0, 1);
    expect(priced.hasPriceGap).toBe(false);
  });

  it('converts oz → lb when computing', () => {
    const priced = estimatePriceForItem(item('chicken breast', 16, 'oz'));
    expect(priced.estimatedPrice).toBeCloseTo(4.5, 1);
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
});
