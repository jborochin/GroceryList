import AsyncStorage from '@react-native-async-storage/async-storage';
import priceDatabase from '../data/priceDatabase.json';
import { PriceRow, __resetPriceCache, loadPriceCache } from '../lib/priceCatalogSync';
import { STORAGE_KEYS } from '../store/storage';
import { PriceEntry } from '../types';
import { findPrice } from '../utils/priceLookup';

const DB = priceDatabase as Record<string, PriceEntry>;

// Exercises the full resolution ladder:
//   overrides -> live overlay -> bundled exact -> substring -> fuzzy
//
// `tofu` ($3.99/lb bundled) is the anchor because it is not BLS-refreshed, so
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
    expect(findPrice('tofu')).toEqual({ pricePerUnit: 3.99, unit: 'lb' });
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
    expect(findPrice('broccoli')).toEqual({ pricePerUnit: 2.77, unit: 'lb' });
  });

  // The overlay is exact-match only; substring and fuzzy resolution stay on the
  // bundled database so behavior for unknown names is unchanged.
  it('does not let the overlay participate in substring or fuzzy matching', async () => {
    await seed([liveTofu(4.5)]);
    // "firm tofu" resolves by substring against the bundled catalog, not the overlay.
    expect(findPrice('firm tofu')).toEqual({ pricePerUnit: 3.99, unit: 'lb' });
  });

  it('ignores an overlay row whose unit contradicts the bundled row', async () => {
    await seed([liveTofu(4.5, 'each')]);
    expect(findPrice('tofu')).toEqual({ pricePerUnit: 3.99, unit: 'lb' });
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

// Substring resolution is bidirectional, and the two directions want opposite winners.
// These pin that down, because the catalog carries specific cuts alongside their generic
// parent and a single sorted scan gets one direction wrong.
describe('findPrice substring ordering', () => {
  const beefSteak = DB['beef steak'];
  const sirloinSteak = DB['sirloin steak'];

  it('is set up against two keys that really do differ in price', () => {
    // Guards the cases below from silently becoming tautologies if the catalog changes.
    expect(beefSteak).toBeDefined();
    expect(sirloinSteak).toBeDefined();
    expect(beefSteak.pricePerUnit).not.toBe(sirloinSteak.pricePerUnit);
  });

  // Pass 4a: a catalog key inside the query -> most specific wins.
  it('prefers the specific cut when the query contains it', () => {
    expect(findPrice('boneless sirloin steak')).toEqual(sirloinSteak);
    expect(findPrice('grass fed sirloin steak, trimmed')).toEqual(sirloinSteak);
  });

  // Pass 4b: the query inside a catalog key -> most generic wins. Without the opposite
  // sort this returns whichever cut happens to have the longest name.
  it('falls back to the generic key for a bare head noun', () => {
    expect(findPrice('steak')).toEqual(beefSteak);
  });

  it('still prefers an exact match over either substring pass', () => {
    expect(findPrice('beef steak')).toEqual(beefSteak);
    expect(findPrice('sirloin steak')).toEqual(sirloinSteak);
  });

  // Whole-word containment: without the space padding, "ham" matches inside "graham".
  it('does not match a catalog key mid-word', () => {
    const ham = findPrice('ham');
    expect(ham).toEqual(DB['ham']);
    expect(findPrice('graham cracker crumbs')).not.toEqual(ham);
  });

  // The failure mode this ordering exists to prevent: resolution must depend on the
  // names involved, not on where a row happens to sit in priceDatabase.json.
  it('does not depend on catalog insertion order', () => {
    const keys = Object.keys(DB);
    expect(keys.indexOf('beef steak')).toBeLessThan(keys.indexOf('sirloin steak'));
    // `beef steak` is the earlier row, so a first-match-wins scan would return it here.
    expect(findPrice('thick cut sirloin steak')).toEqual(sirloinSteak);
  });
});
