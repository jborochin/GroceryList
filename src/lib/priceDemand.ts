import AsyncStorage from '@react-native-async-storage/async-storage';
import { PriceRow, mergeRows } from './priceCatalogSync';

/**
 * Ask the server to freshen prices for what is on the grocery list right now.
 *
 * The server owns freshness: this sends every visible ingredient name and knows nothing
 * about the TTL, so `price_ttl_days` can be retuned in SQL without an app release. The
 * function answers `fresh` for anything still inside the window and only spends a Kroger
 * call on the rest.
 *
 * Entirely best-effort. Every failure path is silent, because the grocery list already
 * renders a price from the bundled catalog before this runs — a resolve landing later only
 * ever sharpens a number that was already on screen. Nothing here is allowed to throw into
 * a render path.
 */

/** Names asked about recently are skipped, regardless of what the server said.
 *  Guards against a device re-asking on every app foreground, which for an unchanged
 *  list is pure round-trip. Much shorter than the server TTL on purpose: this is
 *  request suppression, not a freshness judgement. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const COOLDOWN_KEY = 'mealprep/priceDemand/v1';

/** Matches app_config.ondemand_batch_max. The server slices to its own value anyway;
 *  this just avoids sending an obviously wasteful payload. */
const MAX_NAMES_PER_CALL = 5;

interface ResolveResult {
  name: string;
  status: 'fresh' | 'published' | 'unknown' | 'pending' | 'rejected' | 'disabled';
  price?: { price_per_unit: number; unit: string; as_of: string };
}

interface ResolveResponse {
  ok: boolean;
  results?: ResolveResult[];
}

/**
 * Names with a request in flight this session.
 *
 * Same shape as `pullsInFlight` in src/lib/sync.ts. The debounce upstream collapses a
 * render burst, but two different screens can still materialize overlapping lists, and
 * this keeps that from doubling the call.
 */
const inFlight = new Set<string>();

let cooldown: Record<string, number> | null = null;

async function loadCooldown(): Promise<Record<string, number>> {
  if (cooldown) return cooldown;
  try {
    const stored = await AsyncStorage.getItem(COOLDOWN_KEY);
    const parsed = stored ? (JSON.parse(stored) as Record<string, number>) : {};
    cooldown = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cooldown = {};
  }
  return cooldown;
}

async function markRequested(names: string[]): Promise<void> {
  const map = await loadCooldown();
  const now = Date.now();
  for (const name of names) map[name] = now;

  // Drop entries that aged out, so the record cannot grow without bound as a user's
  // shopping changes over months.
  for (const [name, at] of Object.entries(map)) {
    if (now - at > COOLDOWN_MS) delete map[name];
  }

  try {
    await AsyncStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {
    // In-memory copy still suppresses for this session.
  }
}

/** Test seam — clears module state between cases. */
export function __resetPriceDemand(): void {
  inFlight.clear();
  cooldown = null;
}

/**
 * Request fresh prices for `names`. Never throws, never blocks rendering.
 *
 * Returns the number of names actually sent, which is what the tests assert on — the
 * caller has nothing useful to do with the result, since any new price arrives through
 * the price-catalog store's version counter rather than a return value.
 */
export async function requestPrices(names: string[]): Promise<number> {
  try {
    const { getSupabase, supabaseConfigured } = await import('./supabase');
    if (!supabaseConfigured) return 0;

    const map = await loadCooldown();
    const now = Date.now();

    const candidates = Array.from(new Set(names.filter((n) => n && n.length > 0)))
      .filter((n) => !inFlight.has(n))
      .filter((n) => !(map[n] !== undefined && now - map[n] < COOLDOWN_MS))
      .slice(0, MAX_NAMES_PER_CALL);

    if (candidates.length === 0) return 0;

    for (const n of candidates) inFlight.add(n);
    // Recorded before the call, not after: a request that fails should still cool down,
    // or a persistently failing name retries on every single list change.
    await markRequested(candidates);

    try {
      const { data, error } = await getSupabase().functions.invoke<ResolveResponse>(
        'resolve-prices',
        { body: { names: candidates } }
      );
      if (error || !data || !data.ok || !Array.isArray(data.results)) return candidates.length;

      // Only rows carrying a price are worth merging; `unknown` and `pending` have
      // nothing to add, and the bundled estimate already covers them on screen.
      const rows: PriceRow[] = data.results
        .filter((r) => r.price && (r.status === 'published' || r.status === 'fresh'))
        .map((r) => ({
          normalized_name: r.name,
          price_per_unit: r.price!.price_per_unit,
          unit: r.price!.unit,
          as_of: r.price!.as_of,
        }));

      if (rows.length > 0) mergeRows(rows);
      return candidates.length;
    } finally {
      for (const n of candidates) inFlight.delete(n);
    }
  } catch {
    return 0;
  }
}
