import { categorize } from '../utils/categorizer';

describe('categorize', () => {
  it('matches chicken → Protein', () => {
    expect(categorize('chicken breast')).toBe('Protein');
    expect(categorize('boneless chicken thighs')).toBe('Protein');
  });

  it('matches produce', () => {
    expect(categorize('broccoli')).toBe('Produce');
    expect(categorize('cherry tomatoes')).toBe('Produce');
  });

  it('matches dairy', () => {
    expect(categorize('2% milk')).toBe('Dairy');
    expect(categorize('greek yogurt')).toBe('Dairy');
  });

  it('prefers longer keyword (chicken broth → Pantry, not Protein)', () => {
    expect(categorize('chicken broth')).toBe('Pantry');
  });

  it('falls back to Other', () => {
    expect(categorize('fiddlesticks')).toBe('Other');
  });

  it('matches condiments', () => {
    expect(categorize('olive oil')).toBe('Condiments/Oils');
  });
});
