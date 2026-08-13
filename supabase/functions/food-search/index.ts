// Supabase Edge Function: food-search
//
// The food database behind the Log tab. Three operations:
//
//   { "query": "chobani greek yogurt" }  → text search
//   { "barcode": "0894700010045" }       → scanned-product lookup
//   { "fdcId": "173944" }                → detail, for household portions
//
// All return `{ ok: true, foods: FoodItem[] }`.
//
// Sources, in order:
//   1. USDA FoodData Central — branded products (with UPCs) AND whole foods, so
//      "banana" and "Chobani Greek Yogurt" both resolve from one integration.
//   2. Open Food Facts — barcode only, and only when FDC has no UPC match. FDC's
//      branded set is a US label snapshot; OFF is crowd-sourced and global, so
//      it covers imports, regional brands, and products FDC hasn't ingested.
//      Adding it turns a dead-end scan into a hit for a single extra fetch.
//
// The mapping is NOT duplicated here — it is imported from
// src/utils/foodSearchMapping.ts, the same trick resolve-prices uses to share
// the Kroger matcher. That requires explicit `.ts` extensions on the import
// (Deno resolves specifiers literally) and `allowImportingTsExtensions` in
// tsconfig, which is safe because the project is noEmit. The older
// usda-nutrition function kept its own copy and its header had to say "keep the
// two in sync"; they never are.
//
// Fails open in every direction: a missing key, an upstream error, or a
// zero-result search all return ok:false or an empty list, and the client falls
// back to manual entry.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  mapOffProduct,
  mapUsdaFood,
  mapUsdaSearch,
} from '../../../src/utils/foodSearchMapping.ts';
import type { FoodItem } from '../../../src/types/index.ts';

const FDC_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const FDC_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food';
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 25;
// How many of the 25 slots the curated datasets may claim. Enough that "banana"
// or "chicken breast" resolves at the top, few enough that a brand-name query
// still fills the page with real products.
const GENERIC_RESULTS = 6;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Open Food Facts asks every client to identify itself; anonymous traffic gets
// rate-limited. This is a documented requirement, not politeness.
const OFF_HEADERS: Record<string, string> = {
  'User-Agent': 'MealFlow/1.0 (https://github.com/jborochin/mealflow)',
  Accept: 'application/json',
};

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

// ---------------------------------------------------------------------------
// Cache (public.food_cache — service role only)
//
// FDC's free key allows ~1,000 requests/hour across EVERY user of this app, so
// an uncached search box would exhaust the quota with one enthusiastic user.
// A public database's answer is identical for everyone, so there is nothing
// per-user to key on and nothing to protect.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function cacheGet(key: string): Promise<FoodItem[] | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/food_cache?cache_key=eq.${encodeURIComponent(key)}` +
        `&select=payload,fetched_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ payload: FoodItem[]; fetched_at: string }>;
    const row = rows[0];
    if (!row) return null;
    // Expire on read rather than with a scheduled job: a stale row costs one
    // upstream call to replace, and a dead cleanup job would otherwise freeze
    // the catalog. Same decay strategy as the price overlay.
    if (Date.now() - new Date(row.fetched_at).getTime() > CACHE_TTL_MS) return null;
    return Array.isArray(row.payload) ? row.payload : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, payload: FoodItem[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/food_cache`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: key, payload, fetched_at: new Date().toISOString() }),
    });
  } catch {
    // Best-effort. A failed cache write costs quota, never correctness.
  }
}

// ---------------------------------------------------------------------------
// Upstream lookups
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  const res = await fetch(url, { signal, headers });
  if (!res.ok) return null;
  return await res.json();
}

function searchUrl(query: string, apiKey: string, dataType: string, pageSize: number): string {
  return (
    `${FDC_SEARCH}?api_key=${apiKey}` +
    `&query=${encodeURIComponent(query)}` +
    `&dataType=${encodeURIComponent(dataType)}` +
    `&pageSize=${pageSize}`
  );
}

/**
 * Text search across both halves of FoodData Central.
 *
 * THE TWO QUERIES ARE NOT AN OPTIMISATION — a single combined query does not
 * work. Measured against the live API: "chobani" filtered to Branded returns
 * 23,479 hits, but `dataType=Branded,Foundation,SR Legacy` returns 424, all of
 * them SR Legacy. So does passing no dataType at all, and so does the POST form
 * with a real JSON array. FDC's relevance ranking buries Branded whenever the
 * curated datasets are in scope, which for a food logger is exactly backwards:
 * people log packaged products. Ask the two datasets separately and merge.
 *
 * Generic results lead. They are few and, when they match, they are what the
 * user meant — "banana" should not open on banana bread. Branded fills the rest,
 * which is most of the list for a brand-name query since generics won't match it
 * at all.
 */
async function searchUsda(
  query: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<FoodItem[]> {
  const [generic, branded] = await Promise.all([
    fetchJson(searchUrl(query, apiKey, 'Foundation,SR Legacy', GENERIC_RESULTS), signal),
    fetchJson(searchUrl(query, apiKey, 'Branded', MAX_RESULTS), signal),
  ]);

  const out: FoodItem[] = [];
  const seen = new Set<string>();
  for (const item of [...mapUsdaSearch(generic), ...mapUsdaSearch(branded)]) {
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    out.push(item);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/**
 * Detail for one food, which is the only place household portions live for
 * Foundation and SR Legacy rows — `foodMeasures` comes back empty from search
 * for every dataset. Fetched lazily when the user opens the serving picker on a
 * generic food, so a search costs one call rather than twenty-five.
 */
async function detailUsda(
  fdcId: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<FoodItem | null> {
  const url = `${FDC_DETAIL}/${encodeURIComponent(fdcId)}?api_key=${apiKey}`;
  const payload = await fetchJson(url, signal);
  return payload ? mapUsdaFood(payload as Record<string, unknown>) : null;
}

async function lookupUsdaBarcode(
  barcode: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<FoodItem | null> {
  const url =
    `${FDC_SEARCH}?api_key=${apiKey}` +
    `&query=${encodeURIComponent(barcode)}` +
    `&dataType=${encodeURIComponent('Branded')}&pageSize=5`;
  const items = mapUsdaSearch(await fetchJson(url, signal));
  // FDC's search is full-text, so a UPC query can return near-misses that merely
  // mention the digits. Only an exact gtinUpc match is this product.
  //
  // FDC stores UPCs both bare and zero-padded to 13/14 digits, and scanners
  // report UPC-A as 12 digits, so compare with leading zeroes stripped.
  const target = stripLeadingZeros(barcode);
  return items.find((i) => i.barcode && stripLeadingZeros(i.barcode) === target) ?? null;
}

async function lookupOffBarcode(barcode: string, signal: AbortSignal): Promise<FoodItem | null> {
  const fields =
    'code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments';
  const url = `${OFF_PRODUCT}/${encodeURIComponent(barcode)}.json?fields=${fields}`;
  // OFF answers 404 for an unknown barcode, which fetchJson turns into null.
  return mapOffProduct(await fetchJson(url, signal, OFF_HEADERS));
}

function stripLeadingZeros(code: string): string {
  return code.replace(/^0+/, '') || '0';
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function cleanQuery(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 100) : '';
}

/** A barcode is digits only, 8–14 of them (EAN-8 through GTIN-14). */
function cleanBarcode(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return /^\d{8,14}$/.test(raw) ? raw : '';
}

/** An fdcId is a bare integer. Constrained so it can't be used to path-traverse. */
function cleanFdcId(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return /^\d{1,10}$/.test(raw) ? raw : '';
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { ok: false, kind: 'method-not-allowed' });

  let body: { query?: unknown; barcode?: unknown; fdcId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  const barcode = cleanBarcode(body.barcode);
  const fdcId = cleanFdcId(body.fdcId);
  const query = cleanQuery(body.query);
  if (!barcode && !fdcId && query.length < 2) {
    return json(200, {
      ok: false,
      kind: 'bad-request',
      message: 'send a barcode, an fdcId, or a query of at least 2 characters',
    });
  }

  const apiKey = Deno.env.get('FDC_API_KEY') ?? '';
  // Open Food Facts needs no key, so a barcode scan still works without FDC
  // configured. Nothing else does — refuse rather than pretending.
  if (!apiKey && !barcode) {
    return json(200, { ok: false, kind: 'not-configured', message: 'FDC_API_KEY not set' });
  }

  const cacheKey = barcode
    ? `upc:${barcode}`
    : fdcId
    ? `fdc:${fdcId}`
    : `q:${query.toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return json(200, { ok: true, foods: cached, cached: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let foods: FoodItem[];
    if (barcode) {
      const usda = apiKey ? await lookupUsdaBarcode(barcode, apiKey, controller.signal) : null;
      const item = usda ?? (await lookupOffBarcode(barcode, controller.signal));
      foods = item ? [item] : [];
    } else if (fdcId) {
      const item = await detailUsda(fdcId, apiKey, controller.signal);
      foods = item ? [item] : [];
    } else {
      foods = await searchUsda(query, apiKey, controller.signal);
    }

    // Don't cache a miss. A barcode absent today may be added to Open Food Facts
    // tomorrow, and caching the emptiness would hide it for a month.
    if (foods.length > 0) await cachePut(cacheKey, foods);

    return json(200, { ok: true, foods });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return json(200, { ok: false, kind: 'network', message });
  } finally {
    clearTimeout(timer);
  }
});
