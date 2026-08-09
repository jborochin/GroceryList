import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_PRICE_AGE_DAYS,
  PriceRow,
  __resetPriceCache,
  getLivePrices,
  ingestRows,
  loadPriceCache,
} from '../lib/priceCatalogSync';
import { STORAGE_KEYS } from '../store/storage';

const NOW = Date.parse('2026-08-09T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

// `tofu` is $3.00/lb in the bundled database and is not BLS-refreshed, so it's
// a stable anchor for these fixtures (see the note in priceEstimator.test.ts).
const row = (over: Partial<PriceRow> = {}): PriceRow => ({
  normalized_name: 'tofu',
  price_per_unit: 4.5,
  unit: 'lb',
  as_of: daysAgo(1),
  ...over,
});

beforeEach(async () => {
  __resetPriceCache();
  await AsyncStorage.clear();
});

describe('ingestRows', () => {
  it('indexes a valid row by normalized name', () => {
    expect(ingestRows([row()], NOW)).toEqual({ tofu: { pricePerUnit: 4.5, unit: 'lb' } });
  });

  it('normalizes the incoming name', () => {
    const out = ingestRows([row({ normalized_name: 'Tofu' })], NOW);
    expect(out.tofu).toEqual({ pricePerUnit: 4.5, unit: 'lb' });
  });

  // The unit invariant: getProfile() derives its sell unit from the price entry
  // and roundToPurchasable() branches on that unit's family, so an overlay may
  // restate a price but never change its unit.
  it('drops rows whose unit differs from the bundled row', () => {
    expect(ingestRows([row({ unit: 'each' })], NOW)).toEqual({});
    expect(ingestRows([row({ normalized_name: 'broccoli', unit: 'head' })], NOW)).toEqual({});
  });

  it('keeps rows inside the age limit and drops rows past it', () => {
    expect(ingestRows([row({ as_of: daysAgo(MAX_PRICE_AGE_DAYS - 1) })], NOW)).not.toEqual({});
    expect(ingestRows([row({ as_of: daysAgo(MAX_PRICE_AGE_DAYS + 1) })], NOW)).toEqual({});
  });

  it('drops rows naming a key the bundled database does not have', () => {
    expect(ingestRows([row({ normalized_name: 'unobtainium-7' })], NOW)).toEqual({});
  });

  it('drops rows with an unusable price or timestamp', () => {
    expect(ingestRows([row({ price_per_unit: 0 })], NOW)).toEqual({});
    expect(ingestRows([row({ price_per_unit: -2 })], NOW)).toEqual({});
    expect(ingestRows([row({ price_per_unit: Number.NaN })], NOW)).toEqual({});
    expect(ingestRows([row({ as_of: 'not-a-date' })], NOW)).toEqual({});
  });

  it('keeps the good rows when some are rejected', () => {
    const out = ingestRows([row(), row({ normalized_name: 'broccoli', unit: 'head' })], NOW);
    expect(Object.keys(out)).toEqual(['tofu']);
  });
});

describe('loadPriceCache', () => {
  it('installs a persisted overlay', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify([row()]));
    await loadPriceCache();
    expect(getLivePrices()).toEqual({ tofu: { pricePerUnit: 4.5, unit: 'lb' } });
  });

  it('leaves the overlay empty when nothing is stored', async () => {
    await loadPriceCache();
    expect(getLivePrices()).toBeNull();
  });

  // Raw rows are persisted (not the indexed map) precisely so the age limit is
  // re-evaluated on read — a device that goes offline for months decays back to
  // the bundled prices instead of freezing.
  it('re-evaluates staleness on read, not on write', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.priceCache,
      JSON.stringify([row({ as_of: daysAgo(MAX_PRICE_AGE_DAYS + 5) })])
    );
    await loadPriceCache();
    expect(getLivePrices()).toBeNull();
  });

  it('falls back to the bundled prices on a corrupt cache', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.priceCache, '{not json');
    await loadPriceCache();
    expect(getLivePrices()).toBeNull();
  });

  it('ignores a stored value that is not an array', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify({ tofu: 1 }));
    await loadPriceCache();
    expect(getLivePrices()).toBeNull();
  });
});
