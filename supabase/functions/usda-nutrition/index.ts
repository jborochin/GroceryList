// Supabase Edge Function: usda-nutrition
// Resolves ingredient names to per-100g macros + household-measure portions using
// the USDA FoodData Central API. The client (src/utils/computeNutrition.ts) sends
// a list of unique normalized names and does the quantity→gram summation itself
// (src/utils/nutritionEstimator.ts), so this function is a thin search/detail proxy
// with a cache. Requires the FDC_API_KEY secret (free key from https://fdc.nal.usda.gov).
//
// Mapping logic mirrors src/utils/usdaMapping.ts — keep the two in sync. (Edge
// functions run on Deno and can't import from src/.)
//
// Fails open: when the key is missing or upstream errors, returns ok:false so the
// caller can fall back to the CalorieNinjas engine.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const FDC_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const FDC_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FOODS = 60; // safety cap per request

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
// USDA payload → per100g + portions (mirror of src/utils/usdaMapping.ts)
// ---------------------------------------------------------------------------

const ENERGY_KCAL = '208';
const PROTEIN = '203';
const CARBS = '205';
const FAT = '204';

// deno-lint-ignore no-explicit-any
function extractPer100g(food: any): { calories: number; proteinG: number; carbsG: number; fatG: number } {
  const out = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  let energy208: number | null = null;
  let energyKcalFallback: number | null = null;
  for (const n of food.foodNutrients ?? []) {
    const num = String(n.nutrient?.number ?? n.nutrientNumber ?? '');
    const name = String(n.nutrient?.name ?? '').toLowerCase();
    const unit = String(n.nutrient?.unitName ?? n.unitName ?? '').toUpperCase();
    const amount = typeof n.amount === 'number' ? n.amount : typeof n.value === 'number' ? n.value : 0;
    if (num === ENERGY_KCAL && (unit === 'KCAL' || unit === '')) {
      energy208 = amount;
    } else if (name.includes('energy') && unit === 'KCAL') {
      if (energyKcalFallback === null) energyKcalFallback = amount;
    } else if (num === PROTEIN) out.proteinG = amount;
    else if (num === CARBS) out.carbsG = amount;
    else if (num === FAT) out.fatG = amount;
  }
  out.calories = energy208 ?? energyKcalFallback ?? 0;
  return out;
}

// Recipe ingredient names carry qualifiers ("cherry or grape tomato", "medium
// head of cauliflower", "boneless skinless chicken breast") that make USDA search
// miss or mismatch. Strip them for the SEARCH query only (the original name stays
// the cache key + response key). Overrides bypass this entirely.
// NOTE: cooking-state words (fresh/frozen/dried/raw/cooked) are NOT stripped —
// they change calories per gram, so search must keep them.
const SEARCH_STOP =
  /\b(?:cherry|grape|medium|large|small|baby|ripe|whole|head|of|or|boneless|skinless|chopped|diced|sliced|minced|crushed|smashed|peeled|halved|thinly|finely|extra|virgin|low|reduced|nonfat|unsalted|salted|organic|skin|on|off|cut|into|divided|packed)\b/gi;

function searchQuery(name: string): string {
  const stripped = name.replace(SEARCH_STOP, ' ').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripped || name;
}

const UNIT_KEYWORDS: Array<[RegExp, string]> = [
  [/fl(?:uid)?\.?\s*oz|fluid ounce/i, 'fl_oz'],
  [/\btbsp\b|tablespoon/i, 'tbsp'],
  [/\btsp\b|teaspoon/i, 'tsp'],
  [/\bcup\b/i, 'cup'],
  [/\bquart\b/i, 'quart'],
  [/\bpint\b/i, 'pint'],
  [/\b(?:medium|large|small|whole|each|piece|fruit|clove|slice|serving|link|fillet|breast|thigh)\b/i, 'each'],
];

function canonicalPortionUnit(text: string): string | null {
  for (const [re, unit] of UNIT_KEYWORDS) if (re.test(text)) return unit;
  return null;
}

// deno-lint-ignore no-explicit-any
function extractPortions(food: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of food.foodPortions ?? []) {
    const grams = typeof p.gramWeight === 'number' ? p.gramWeight : 0;
    if (grams <= 0) continue;
    const amount = typeof p.amount === 'number' && p.amount > 0 ? p.amount : 1;
    const label = `${p.measureUnit?.name ?? ''} ${p.modifier ?? p.portionDescription ?? ''}`.trim();
    const unit = canonicalPortionUnit(label);
    if (!unit) continue;
    if (!(unit in out)) out[unit] = grams / amount;
  }
  return out;
}

interface MappedFood {
  name: string;
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number };
  portions: Record<string, number>;
}

// Pinned fdcIds for common foods so search fuzziness doesn't pick odd matches.
// Keep in sync with src/data/usdaOverrides.json.
const OVERRIDES: Record<string, number> = {
  'skirt steak': 172159,
  'chicken breast': 171477,
  'boneless skinless chicken breast': 171477,
  'ground beef': 174036,
  salmon: 175167,
  egg: 748967,
  'large egg': 748967,
  butter: 173410,
  'olive oil': 171413,
  'extra-virgin olive oil': 171413,
  'vegetable oil': 172336,
  'all-purpose flour': 169761,
  flour: 169761,
  'granulated sugar': 169655,
  sugar: 169655,
  'brown rice': 169704,
  'cooked brown rice': 169704,
  'white rice': 169756,
  'black bean': 173735,
  avocado: 171705,
  'yellow onion': 170000,
  onion: 170000,
  'bell pepper': 170108,
  garlic: 169230,
  lime: 168155,
  lemon: 167746,
  cilantro: 169997,
  'sour cream': 171256,
  parmesan: 171247,
  'cheddar cheese': 173414,
  milk: 746782,
  'frozen corn': 169998,
};

// ---------------------------------------------------------------------------
// Optional cache (public.usda_cache: name text primary key, payload jsonb)
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function cacheGet(name: string): Promise<MappedFood | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/usda_cache?name=eq.${encodeURIComponent(name)}&select=payload`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ payload: MappedFood }>;
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function cachePut(name: string, payload: MappedFood): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/usda_cache`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ name, payload, fetched_at: new Date().toISOString() }),
    });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// USDA lookup
// ---------------------------------------------------------------------------

async function fdcJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return await res.json();
}

async function resolveFood(name: string, apiKey: string, signal: AbortSignal): Promise<MappedFood | null> {
  const cached = await cacheGet(name);
  if (cached) return cached;

  // Pinned override wins; otherwise prefer whole-food datasets (per-100g
  // semantics, real portions) over Branded.
  let fdcId = OVERRIDES[name];
  if (!fdcId) {
    const searchUrl =
      `${FDC_SEARCH}?api_key=${apiKey}&query=${encodeURIComponent(searchQuery(name))}` +
      `&dataType=${encodeURIComponent('Foundation,SR Legacy')}&pageSize=1`;
    // deno-lint-ignore no-explicit-any
    const search = (await fdcJson(searchUrl, signal)) as any;
    fdcId = search?.foods?.[0]?.fdcId;
  }
  if (!fdcId) return null;

  const detailUrl = `${FDC_DETAIL}/${fdcId}?api_key=${apiKey}`;
  const detail = await fdcJson(detailUrl, signal);
  if (!detail) return null;

  const mapped: MappedFood = {
    name,
    per100g: extractPer100g(detail),
    portions: extractPortions(detail),
  };
  if (mapped.per100g.calories <= 0 && mapped.per100g.proteinG <= 0) return null;
  await cachePut(name, mapped);
  return mapped;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { ok: false, kind: 'method-not-allowed' });

  let body: { foods?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  const foods = Array.isArray(body.foods)
    ? Array.from(
        new Set(
          body.foods
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        ),
      ).slice(0, MAX_FOODS)
    : [];
  if (foods.length === 0) {
    return json(200, { ok: false, kind: 'bad-request', message: 'foods must be a non-empty string array' });
  }

  const apiKey = Deno.env.get('FDC_API_KEY');
  if (!apiKey) return json(200, { ok: false, kind: 'not-configured', message: 'FDC_API_KEY not set' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const results = await Promise.all(
      foods.map((name) => resolveFood(name, apiKey, controller.signal).catch(() => null)),
    );
    const matched = results.filter((f): f is MappedFood => f !== null);
    return json(200, { ok: true, foods: matched });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return json(200, { ok: false, kind: 'network', message });
  } finally {
    clearTimeout(timer);
  }
});
