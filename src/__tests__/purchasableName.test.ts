import { toPurchasableName } from '../utils/purchasableName';

describe('toPurchasableName', () => {
  it('strips a leading prep descriptor', () => {
    expect(toPurchasableName('diced red bell pepper')).toBe('red bell pepper');
  });

  it('strips a trailing comma-form descriptor', () => {
    expect(toPurchasableName('red bell pepper, diced')).toBe('red bell pepper');
  });

  it('protects known canned-good products from stripping', () => {
    expect(toPurchasableName('diced tomatoes')).toBe('diced tomatoes');
    expect(toPurchasableName('crushed tomatoes')).toBe('crushed tomatoes');
  });

  it('leaves food-defining modifiers intact', () => {
    expect(toPurchasableName('cherry tomatoes')).toBe('cherry tomatoes');
    expect(toPurchasableName('ground beef')).toBe('ground beef');
    expect(toPurchasableName('green onion')).toBe('green onion');
  });

  it('never collapses to an empty string', () => {
    expect(toPurchasableName('chopped')).toBe('chopped');
  });

  it('leaves plain names untouched', () => {
    expect(toPurchasableName('flour')).toBe('flour');
  });
});
