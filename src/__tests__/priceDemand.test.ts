import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetPriceCache, getLivePrices, mergeRows } from '../lib/priceCatalogSync';
import { __resetPriceDemand, requestPrices } from '../lib/priceDemand';
import { STORAGE_KEYS } from '../store/storage';

const invoke = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabaseConfigured: true,
  getSupabase: () => ({ functions: { invoke: (...a: unknown[]) => invoke(...a) } }),
}));

const iso = (d = new Date()) => d.toISOString();

beforeEach(async () => {
  __resetPriceCache();
  __resetPriceDemand();
  await AsyncStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { ok: true, results: [] }, error: null });
});

describe('mergeRows', () => {
  it('adds a resolved price without dropping the rest of the overlay', async () => {
    // A full refresh landed first...
    await AsyncStorage.setItem(
      STORAGE_KEYS.priceCache,
      JSON.stringify([{ normalized_name: 'tofu', price_per_unit: 4.5, unit: 'lb', as_of: iso() }])
    );
    const { loadPriceCache } = await import('../lib/priceCatalogSync');
    await loadPriceCache();
    expect(getLivePrices()?.tofu).toEqual({ pricePerUnit: 4.5, unit: 'lb' });

    // ...then a single on-demand row arrives. install() would replace the whole cache
    // and lose tofu; mergeRows must not.
    mergeRows([{ normalized_name: 'apple', price_per_unit: 2.5, unit: 'lb', as_of: iso() }]);
    expect(getLivePrices()?.apple).toEqual({ pricePerUnit: 2.5, unit: 'lb' });
    expect(getLivePrices()?.tofu).toEqual({ pricePerUnit: 4.5, unit: 'lb' });
  });

  it('applies the same validation as a full refresh', () => {
    // Wrong unit for the bundled row -> dropped, exactly as ingestRows would.
    mergeRows([{ normalized_name: 'tofu', price_per_unit: 4.5, unit: 'each', as_of: iso() }]);
    expect(getLivePrices()).toBeNull();
  });

  it('is a no-op when every row fails validation', () => {
    mergeRows([{ normalized_name: 'not-an-ingredient', price_per_unit: 1, unit: 'lb', as_of: iso() }]);
    expect(getLivePrices()).toBeNull();
  });
});

describe('requestPrices', () => {
  it('sends the requested names and merges what comes back', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        results: [
          { name: 'tofu', status: 'published', price: { price_per_unit: 5.25, unit: 'lb', as_of: iso() } },
        ],
      },
      error: null,
    });

    const sent = await requestPrices(['tofu']);
    expect(sent).toBe(1);
    expect(invoke).toHaveBeenCalledWith('resolve-prices', { body: { names: ['tofu'] } });
    expect(getLivePrices()?.tofu).toEqual({ pricePerUnit: 5.25, unit: 'lb' });
  });

  it('does not re-ask for a name inside the cooldown', async () => {
    await requestPrices(['tofu']);
    expect(invoke).toHaveBeenCalledTimes(1);

    const sent = await requestPrices(['tofu']);
    expect(sent).toBe(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('cools down even when the call fails, so a bad name cannot retry forever', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await requestPrices(['tofu']);
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValue({ data: { ok: true, results: [] }, error: null });
    await requestPrices(['tofu']);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('caps the batch so a long list cannot become one huge request', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `ingredient-${i}`);
    await requestPrices(many);
    const names = invoke.mock.calls[0][1].body.names as string[];
    expect(names).toHaveLength(5);
  });

  it('de-duplicates before sending', async () => {
    await requestPrices(['tofu', 'tofu', 'apple']);
    expect(invoke.mock.calls[0][1].body.names).toEqual(['tofu', 'apple']);
  });

  it('ignores results that carry no price', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        results: [
          { name: 'unobtainium', status: 'unknown' },
          { name: 'tofu', status: 'pending' },
        ],
      },
      error: null,
    });
    await requestPrices(['unobtainium', 'tofu']);
    expect(getLivePrices()).toBeNull();
  });

  it('never throws when the function errors', async () => {
    invoke.mockRejectedValue(new Error('network down'));
    await expect(requestPrices(['tofu'])).resolves.toBe(0);
  });

  it('sends nothing when given an empty list', async () => {
    expect(await requestPrices([])).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
