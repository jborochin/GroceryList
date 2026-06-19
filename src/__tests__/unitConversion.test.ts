import { convert, getFamily, prettyUnit } from '../utils/unitConversion';

describe('unitConversion', () => {
  it('identifies families', () => {
    expect(getFamily('tsp')).toBe('volume');
    expect(getFamily('g')).toBe('weight');
    expect(getFamily('each')).toBe('count');
    expect(getFamily('foobar')).toBeNull();
  });

  it('converts within volume family', () => {
    expect(convert(1, 'tbsp', 'tsp')).toBeCloseTo(3, 5);
    expect(convert(1, 'cup', 'tbsp')).toBeCloseTo(16, 5);
    expect(convert(2, 'cup', 'fl_oz')).toBeCloseTo(16, 5);
  });

  it('converts within weight family', () => {
    expect(convert(1, 'kg', 'g')).toBeCloseTo(1000, 5);
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 1);
  });

  it('returns null across families', () => {
    expect(convert(1, 'cup', 'g')).toBeNull();
    expect(convert(1, 'each', 'g')).toBeNull();
  });

  it('returns null across count labels', () => {
    expect(convert(1, 'each', 'slice')).toBeNull();
  });

  it('treats scoop as a count unit', () => {
    expect(getFamily('scoop')).toBe('count');
    expect(convert(2, 'scoop', 'scoop')).toBe(2);
    expect(convert(1, 'scoop', 'each')).toBeNull();
  });

  it('returns same-value for same unit', () => {
    expect(convert(3, 'tsp', 'tsp')).toBe(3);
  });

  it('prettifies volume up to cup', () => {
    const r = prettyUnit(48, 'tsp');
    expect(r.unit).toBe('cup');
    expect(r.quantity).toBeCloseTo(1, 2);
  });

  it('prettifies weight kg', () => {
    const r = prettyUnit(1000, 'g');
    expect(r.unit).toBe('kg');
    expect(r.quantity).toBeCloseTo(1, 2);
  });
});
