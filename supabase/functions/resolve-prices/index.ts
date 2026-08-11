// Supabase Edge Function: resolve-prices
//
// On-demand half of the pricing pipeline. The app sends the ingredient names
// currently on someone's grocery list; this decides which of them are stale
// enough to be worth a Kroger call, resolves those, and publishes the result to
// public.prices where the client's overlay picks it up.
//
// Why it exists: the weekly job cannot cover a 349-key catalog at 12 stores
// inside Kroger's 10,000/day quota, and refreshing an ingredient nobody is
// buying is wasted budget. Demand decides instead of the alphabet.
//
// Three things keep it cheap and safe:
//
//  1. NOTHING OUTSIDE THE CATALOG TRIGGERS A CALL. A name with no price_sources
//     row returns `unknown` immediately. That is both the "known ingredients
//     only" rule and the guard against someone posting junk to burn the quota.
//  2. THE SERVER OWNS FRESHNESS. The client sends every visible name and knows
//     nothing about the TTL, so retuning price_ttl_days needs no app release.
//  3. ONE RESOLVE PER INGREDIENT AT A TIME. A short lease on the price_sources
//     row means two devices asking for the same stale ingredient produce one
//     Kroger call, not two.
//
// Rejection is always safe: an ingredient that fails any gate keeps its previous
// price, or falls through to the app's bundled estimate.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { KROGER_REFERENCE_LOCATIONS, KrogerClient } from '../../../scripts/lib/krogerClient.ts';
import { resolveIngredient } from '../../../scripts/lib/resolveIngredient.ts';
import type { ResolveProfile } from '../../../scripts/lib/resolveIngredient.ts';
import { normalizeName } from '../../../src/utils/normalizeName.ts';
import { convertMeasure } from '../_shared/measure.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Fallbacks used only when app_config is unreachable — same values as its defaults. */
const CONFIG_FALLBACK = {
  price_ttl_days: 14,
  ondemand_enabled: true,
  ondemand_batch_max: 5,
  ondemand_store_count: 3,
  ondemand_lease_seconds: 120,
} as const;

type Config = typeof CONFIG_FALLBACK;

/**
 * Coerce a jsonb config value to a number, tolerating `14` and `"14"` alike.
 *
 * app_config is hand-edited in SQL, where `set value = '14'` stores a JSON *string* and
 * `set value = '14'::jsonb` stores a number. Both are things a person will reasonably
 * type, and neither should change behavior.
 */
function cfgNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Coerce a jsonb config value to a boolean, FAILING SAFE.
 *
 * Anything that reads as "off" turns the feature off — `false`, `"false"`, `0`, `"0"`.
 * The asymmetry is deliberate: `ondemand_enabled` is a kill switch, and the cost of
 * honoring an ambiguous value is one skipped refresh, while the cost of ignoring it is
 * an uncontrolled spend against the Kroger quota that the operator believed they had
 * already stopped.
 */
function cfgBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
    if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  }
  return fallback;
}

async function loadConfig(supabase: SupabaseClient): Promise<Config> {
  const { data, error } = await supabase.from('app_config').select('key, value');
  if (error || !data) return { ...CONFIG_FALLBACK };
  const raw = new Map<string, unknown>(
    (data as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value])
  );
  return {
    price_ttl_days: cfgNumber(raw.get('price_ttl_days'), CONFIG_FALLBACK.price_ttl_days),
    ondemand_enabled: cfgBoolean(raw.get('ondemand_enabled'), CONFIG_FALLBACK.ondemand_enabled),
    ondemand_batch_max: cfgNumber(raw.get('ondemand_batch_max'), CONFIG_FALLBACK.ondemand_batch_max),
    ondemand_store_count: cfgNumber(
      raw.get('ondemand_store_count'),
      CONFIG_FALLBACK.ondemand_store_count
    ),
    ondemand_lease_seconds: cfgNumber(
      raw.get('ondemand_lease_seconds'),
      CONFIG_FALLBACK.ondemand_lease_seconds
    ),
  };
}

type Status = 'fresh' | 'published' | 'unknown' | 'pending' | 'rejected' | 'disabled';

interface Result {
  name: string;
  status: Status;
  price?: { price_per_unit: number; unit: string; as_of: string };
  /** Present on `rejected`, so the run report and review queue agree on why. */
  reason?: string;
}

interface PriceSourceRow {
  normalized_name: string;
  search_term: string;
  kroger_product_id: string | null;
  reviewed: boolean;
  baseline_price_per_unit: number;
  baseline_unit: string;
  purchase_profile: ResolveProfile | null;
}

/**
 * Record that someone wants this ingredient priced.
 *
 * Runs for EVERY requested name, including ones we cannot price. That is the point:
 * unknown names accumulate here so the catalog can grow from what people actually add
 * rather than from guesswork, and known names give the weekly top-up its ordering.
 *
 * Best-effort — a demand-counter failure must never cost the caller a price.
 */
async function recordDemand(
  supabase: SupabaseClient,
  name: string,
  inCatalog: boolean
): Promise<void> {
  try {
    await supabase.rpc('bump_ingredient_demand', {
      p_normalized_name: name,
      p_in_catalog: inCatalog,
    });
  } catch {
    // ignore
  }
}

/**
 * Claim the right to resolve this ingredient, or report that someone else holds it.
 *
 * The lease IS `last_resolved_at`: the conditional update only matches a row nobody has
 * touched inside the lease window, so a second concurrent invocation matches zero rows
 * and backs off. Self-expiring, no lock table, and it reuses a column that already had to
 * be written on every resolve.
 */
async function claimLease(
  supabase: SupabaseClient,
  name: string,
  leaseSeconds: number
): Promise<boolean> {
  const cutoff = new Date(Date.now() - leaseSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from('price_sources')
    .update({ last_status: 'resolving', last_resolved_at: new Date().toISOString() })
    .eq('normalized_name', name)
    .or(`last_resolved_at.is.null,last_resolved_at.lt.${cutoff}`)
    .select('normalized_name');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { ok: false, kind: 'method-not-allowed' });

  let body: { names?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  if (!Array.isArray(body.names)) {
    return json(200, { ok: false, kind: 'bad-request', message: 'names must be an array' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const krogerId = Deno.env.get('KROGER_CLIENT_ID');
  const krogerSecret = Deno.env.get('KROGER_CLIENT_SECRET');
  if (!supabaseUrl || !serviceKey) {
    return json(200, { ok: false, kind: 'not-configured', message: 'supabase env missing' });
  }

  // Service role: public.prices has no insert policy, deliberately, so this is the
  // only way to publish. The key never leaves the function.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const config = await loadConfig(supabase);

  // De-duplicate and normalize before anything else, so a list with "Tomatoes" and
  // "tomato" on it costs one lookup rather than two.
  const names = Array.from(
    new Set(
      body.names
        .filter((n): n is string => typeof n === 'string')
        .map((n) => normalizeName(n))
        .filter((n) => n.length > 0)
    )
  ).slice(0, Math.max(1, config.ondemand_batch_max));

  if (names.length === 0) return json(200, { ok: true, results: [] });

  // Load catalog rows and current prices for the whole batch in two queries rather
  // than two per name.
  const { data: sourceRows } = await supabase
    .from('price_sources')
    .select(
      'normalized_name, search_term, kroger_product_id, reviewed, baseline_price_per_unit, baseline_unit, purchase_profile'
    )
    .in('normalized_name', names);
  const sources = new Map<string, PriceSourceRow>(
    ((sourceRows ?? []) as PriceSourceRow[]).map((r) => [r.normalized_name, r])
  );

  const { data: priceRows } = await supabase
    .from('prices')
    .select('normalized_name, price_per_unit, unit, as_of')
    .in('normalized_name', names);
  // Reshaped rather than stored raw, so every `price` in the response has the same
  // three fields whichever branch produced it.
  const prices = new Map<string, { price_per_unit: number; unit: string; as_of: string }>(
    ((priceRows ?? []) as Array<{
      normalized_name: string;
      price_per_unit: number;
      unit: string;
      as_of: string;
    }>).map((r) => [
      r.normalized_name,
      { price_per_unit: r.price_per_unit, unit: r.unit, as_of: r.as_of },
    ])
  );

  await Promise.all(names.map((n) => recordDemand(supabase, n, sources.has(n))));

  const ttlMs = config.price_ttl_days * 24 * 60 * 60 * 1000;
  const results: Result[] = [];
  const toResolve: PriceSourceRow[] = [];

  for (const name of names) {
    const source = sources.get(name);
    // Not in the catalog: no Kroger call, ever. The demand row above is the whole
    // response to this case -- it is how the ingredient eventually gets enrolled.
    if (!source) {
      results.push({ name, status: 'unknown' });
      continue;
    }
    const current = prices.get(name);
    if (current) {
      const age = Date.now() - Date.parse(current.as_of);
      if (Number.isFinite(age) && age < ttlMs) {
        results.push({ name, status: 'fresh', price: current });
        continue;
      }
    }
    toResolve.push(source);
  }

  if (!config.ondemand_enabled) {
    for (const source of toResolve) {
      const current = prices.get(source.normalized_name);
      results.push({ name: source.normalized_name, status: 'disabled', price: current });
    }
    return json(200, { ok: true, results });
  }

  if (toResolve.length > 0 && (!krogerId || !krogerSecret)) {
    return json(200, { ok: false, kind: 'not-configured', message: 'kroger env missing' });
  }

  if (toResolve.length > 0) {
    const storeCount = Math.max(1, config.ondemand_store_count);
    // Far fewer stores than the weekly job's twelve: someone is waiting on this
    // response. The weekly top-up re-medians the same SKU properly later.
    const locationIds = KROGER_REFERENCE_LOCATIONS.slice(0, storeCount).map((l) => l.id);
    const kroger = new KrogerClient(krogerId!, krogerSecret!);
    const leaseSeconds = Math.max(1, config.ondemand_lease_seconds);

    for (const source of toResolve) {
      const name = source.normalized_name;
      const stale = prices.get(name);

      if (!(await claimLease(supabase, name, leaseSeconds))) {
        // Another invocation is already resolving this one. Hand back whatever we
        // have rather than making a duplicate call.
        results.push({ name, status: 'pending', price: stale });
        continue;
      }

      try {
        const resolution = await resolveIngredient(
          kroger,
          {
            normalizedName: name,
            searchTerm: source.search_term,
            reviewed: source.reviewed,
            krogerProductId: source.kroger_product_id,
            baselinePricePerUnit: source.baseline_price_per_unit,
            baselineUnit: source.baseline_unit,
          },
          locationIds,
          { profile: source.purchase_profile ?? undefined, convertMeasure }
        );

        await supabase
          .from('price_sources')
          .update({
            kroger_product_id: resolution.productId ?? source.kroger_product_id,
            kroger_description: resolution.description ?? null,
            confidence: resolution.confidence ?? null,
            last_resolved_at: new Date().toISOString(),
            last_status: resolution.status,
          })
          .eq('normalized_name', name);

        if (resolution.status === 'published' && resolution.pricePerUnit != null) {
          const asOf = new Date().toISOString();
          await supabase.from('prices').upsert(
            {
              normalized_name: name,
              price_per_unit: resolution.pricePerUnit,
              unit: resolution.unit,
              // Distinguishable from the weekly 12-store median, which overwrites it.
              source: 'kroger-ondemand',
              confidence: resolution.confidence ?? null,
              as_of: asOf,
            },
            { onConflict: 'normalized_name' }
          );
          results.push({
            name,
            status: 'published',
            price: { price_per_unit: resolution.pricePerUnit, unit: resolution.unit, as_of: asOf },
          });
        } else {
          // Rejection keeps whatever was published before, or the bundled estimate.
          results.push({ name, status: 'rejected', reason: resolution.status, price: stale });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 80) : 'unknown';
        await supabase
          .from('price_sources')
          .update({ last_status: `rejected:error(${message})` })
          .eq('normalized_name', name);
        results.push({ name, status: 'rejected', reason: 'error', price: stale });
      }
    }
  }

  return json(200, { ok: true, results });
});
