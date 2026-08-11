import AsyncStorage from '@react-native-async-storage/async-storage';
import priceDatabase from '../data/priceDatabase.json';
import { STORAGE_KEYS } from '../store/storage';
import { usePriceCatalogStore } from '../store/usePriceCatalogStore';
import { PriceEntry } from '../types';
import { normalizeName } from '../utils/normalizeName';

// The global `prices` table is public-read and NOT part of the per-user sync
// (pullAll/subscribeStores). It is an OVERLAY on the bundled priceDatabase.json,
// refreshed weekly server-side by scripts/refreshKrogerPrices.ts, so prices can
// improve without an app release. The bundled JSON is always the floor — an
// empty, stale, or missing overlay just means today's behavior.

/** A published price older than this is ignored, so a dead refresh job decays
 *  back to the bundled prices instead of freezing at a stale value forever. */
export const MAX_PRICE_AGE_DAYS = 60;

export interface PriceRow {
  normalized_name: string;
  price_per_unit: number;
  unit: string;
  as_of: string;
}

let cache: Record<string, PriceEntry> | null = null;

// Unit of every bundled price key, by normalized name. The overlay is only
// allowed to restate a price, never to change its unit — see `ingestRows`.
const BUNDLED_UNITS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(priceDatabase as Record<string, PriceEntry>)) {
    out[normalizeName(key)] = entry.unit;
  }
  return out;
})();

/**
 * Validate and index server rows into a name → price map.
 *
 * Two rows are dropped rather than trusted:
 *
 *  - **Wrong unit.** getProfile() derives its sell unit from the price entry
 *    (src/utils/purchaseProfile.ts) and roundToPurchasable() branches on that
 *    unit's family, so an overlay that changed `lb` to `each` would silently
 *    change rounding. The refresh job enforces this too; checking again here
 *    means a bad server row can't reach the pipeline.
 *  - **Stale or unknown.** Past the age limit, or naming a key the bundled
 *    database no longer has (so there is no unit to validate against).
 */
export function ingestRows(rows: PriceRow[], now: number = Date.now()): Record<string, PriceEntry> {
  const maxAgeMs = MAX_PRICE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const out: Record<string, PriceEntry> = {};

  for (const row of rows) {
    if (!row || typeof row.normalized_name !== 'string') continue;

    const name = normalizeName(row.normalized_name);
    const bundledUnit = BUNDLED_UNITS[name];
    if (!bundledUnit || row.unit !== bundledUnit) continue;

    const price = Number(row.price_per_unit);
    if (!Number.isFinite(price) || price <= 0) continue;

    const asOf = Date.parse(row.as_of);
    if (!Number.isFinite(asOf) || now - asOf > maxAgeMs) continue;

    out[name] = { pricePerUnit: price, unit: row.unit };
  }

  return out;
}

/**
 * Synchronous overlay accessor for findPrice(). Returns null when no refresh
 * has landed, which keeps price resolution entirely on the bundled database.
 */
export function getLivePrices(): Record<string, PriceEntry> | null {
  return cache;
}

/** Test seam — resets the module-level cache between cases. */
export function __resetPriceCache(): void {
  cache = null;
}

function install(entries: Record<string, PriceEntry>): void {
  if (Object.keys(entries).length === 0) return;
  cache = entries;
  usePriceCatalogStore.getState().bump();
}

/**
 * Fold a handful of freshly resolved rows into the overlay.
 *
 * Deliberately NOT `install()`. That one replaces the cache wholesale, which is right for
 * a full-table refresh and wrong here — an on-demand response carries only the few
 * ingredients someone happens to be looking at, so replacing would drop every other live
 * price until the next full refresh. Its empty-guard is wrong here too: rows that all fail
 * validation should still be a no-op, but for the opposite reason.
 *
 * Rows go through the same `ingestRows` validation as the full refresh, so a bad server
 * row cannot enter the pipeline by this shorter path either.
 */
export function mergeRows(rows: PriceRow[]): void {
  const accepted = ingestRows(rows);
  if (Object.keys(accepted).length === 0) return;
  cache = { ...(cache ?? {}), ...accepted };
  usePriceCatalogStore.getState().bump();

  // Persist so the merged prices survive a restart, same as the full refresh. Merge by
  // name rather than append, or the stored array grows a duplicate per resolve.
  void (async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.priceCache);
      const previous = stored ? (JSON.parse(stored) as PriceRow[]) : [];
      const byName = new Map<string, PriceRow>();
      for (const row of Array.isArray(previous) ? previous : []) {
        if (row && typeof row.normalized_name === 'string') byName.set(row.normalized_name, row);
      }
      for (const row of rows) {
        if (row && typeof row.normalized_name === 'string') byName.set(row.normalized_name, row);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify([...byName.values()]));
    } catch {
      // Persistence is best-effort; the in-memory merge above already took effect.
    }
  })();
}

/**
 * Load any persisted overlay from a previous session. Call once on app start so
 * an offline launch still sees the last-known prices. Raw rows are persisted
 * (not the indexed map) so the age limit is re-evaluated on every read.
 */
export async function loadPriceCache(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.priceCache);
    if (!stored) return;
    const parsed = JSON.parse(stored) as PriceRow[];
    if (!Array.isArray(parsed)) return;
    install(ingestRows(parsed));
  } catch {
    // Corrupt cache — ignore, bundled prices stand in.
  }
}

/**
 * Fire-and-forget refresh from the server mirror. Never throws and never blocks
 * rendering; failure silently leaves the bundled/cached prices in place.
 */
export async function refreshPriceCache(): Promise<void> {
  try {
    // Lazy import: src/lib/supabase pulls native polyfills that break under Jest,
    // and this module is reachable from the pure pricing utilities.
    const { getSupabase, supabaseConfigured } = await import('./supabase');
    if (!supabaseConfigured) return;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('prices')
      .select('normalized_name, price_per_unit, unit, as_of');
    if (error || !data || data.length === 0) return;

    const rows = data as PriceRow[];
    install(ingestRows(rows));
    await AsyncStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify(rows));
  } catch {
    // Network/parse error — keep existing prices.
  }
}
