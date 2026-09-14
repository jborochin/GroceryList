import { useItemOverrideStore } from '../store/useItemOverrideStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';

beforeEach(() => {
  useItemOverrideStore.setState({ overrides: {} });
  usePriceOverrideStore.setState({ overrides: {} });
});

describe('useItemOverrideStore.setOverride', () => {
  it('canonicalizes the unit so a typed "lbs" still prices', () => {
    useItemOverrideStore.getState().setOverride('beef', 'Beef', 2, 'lbs', 'Protein');
    expect(useItemOverrideStore.getState().overrides.beef.unit).toBe('lb');
  });

  it('keys by normalized name', () => {
    useItemOverrideStore.getState().setOverride('Chicken Breasts', 'Chicken', 1, 'lb', 'Protein');
    expect(Object.keys(useItemOverrideStore.getState().overrides)).toEqual(['chicken breast']);
  });

  it('ignores a non-positive or non-finite quantity', () => {
    useItemOverrideStore.getState().setOverride('beef', 'Beef', 0, 'lb', 'Protein');
    useItemOverrideStore.getState().setOverride('beef', 'Beef', NaN, 'lb', 'Protein');
    expect(useItemOverrideStore.getState().overrides).toEqual({});
  });
});

describe('usePriceOverrideStore.setOverride', () => {
  it('canonicalizes the unit', () => {
    usePriceOverrideStore.getState().setOverride('beef', 4.99, 'pounds');
    expect(usePriceOverrideStore.getState().overrides.beef.unit).toBe('lb');
  });

  it('keys by normalized name', () => {
    usePriceOverrideStore.getState().setOverride('Chicken Breasts', 4.99, 'lb');
    expect(Object.keys(usePriceOverrideStore.getState().overrides)).toEqual(['chicken breast']);
  });

  it('ignores a zero, negative, or non-finite price', () => {
    usePriceOverrideStore.getState().setOverride('beef', 0, 'lb');
    usePriceOverrideStore.getState().setOverride('beef', -1, 'lb');
    usePriceOverrideStore.getState().setOverride('beef', Infinity, 'lb');
    expect(usePriceOverrideStore.getState().overrides).toEqual({});
  });
});
