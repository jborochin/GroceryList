import AsyncStorage from '@react-native-async-storage/async-storage';
import { PriceRow, __resetPriceCache, loadPriceCache } from '../lib/priceCatalogSync';
import { STORAGE_KEYS } from '../store/storage';
import { findPrice } from '../utils/priceLookup';

// Exercises the full resolution ladder:
//   overrides -> live overlay -> bundled exact -> substring -> fuzzy
//
// `tofu` ($3.00/lb bundled) is the anchor because it is not BLS-refreshed, so
// its bundled value is stable across `npm run prices:refresh-bls`.

const seed = async (rows: PriceRow[]) => {
  await AsyncStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify(rows));
  await loadPriceCache();
};

const liveTofu = (pricePerUnit: number, unit = 'lb'): PriceRow => ({
  normalized_name: 'tofu',
  price_per_unit: pricePerUnit,
  unit,
  as_of: new Date().toISOString(),
});

beforeEach(async () => {
  __resetPriceCache();
  await AsyncStorage.clear();
});

describe('findPrice resolution ladder', () => {
  it('uses the bundled price when no overlay has loaded', () => {
    expect(findPrice('tofu')).toEqual({ pricePerUnit: 3, unit: 'lb' });
  });

  it('prefers a live overlay price over the bundled one', async () => {
    await seed([liveTofu(4.5)]);
    expect(findPrice('tofu')).toEqual({ pricePerUnit: 4.5, unit: 'lb' });
  });

  it('lets a user override beat the live overlay', async () => {
    await seed([liveTofu(4.5)]);
    const overrides = { tofu: { name: 'tofu', pricePerUnit: 99, unit: 'lb' } };
    expect(findPrice('tofu', overrides)).toEqual({ pricePerUnit: 99, unit: 'lb' });
  });

  it('falls through to the bundled price for ingredients with no live row', async () => {
    await seed([liveTofu(4.5)]);
    expect(findPrice('broccoli')).toEqual({ pricePerUnit: 2, unit: 'lb' });
  });

  // The overlay is exact-match only; substring and fuzzy resolution stay on the
  // bundled database so behavior for unknown names is unchanged.
  it('does not let the overlay participate in substring or fuzzy matching', async () => {
    await seed([liveTofu(4.5)]);
    // "firm tofu" resolves by substring against the bundled catalog, not the overlay.
    expect(findPrice('firm tofu')).toEqual({ pricePerUnit: 3, unit: 'lb' });
  });

  it('ignores an overlay row whose unit contradicts the bundled row', async () => {
    await seed([liveTofu(4.5, 'each')]);
    expect(findPrice('tofu')).toEqual({ pricePerUnit: 3, unit: 'lb' });
  });

  it('still returns null for names the catalog cannot resolve at all', async () => {
    await seed([liveTofu(4.5)]);
    expect(findPrice('unobtainium-7')).toBeNull();
  });

  it('normalizes the queried name against the overlay', async () => {
    await seed([liveTofu(4.5)]);
    expect(findPrice('Tofu')).toEqual({ pricePerUnit: 4.5, unit: 'lb' });
  });
});
