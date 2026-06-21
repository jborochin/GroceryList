// Supabase Edge Function: compute-nutrition
// Calls CalorieNinjas to derive macros from raw ingredient strings. This is now
// the FALLBACK engine — the primary engine is usda-nutrition (see
// src/utils/computeNutrition.ts, which prefers USDA and falls back here).
// Returns perRecipe + perServing so callers can detect whether a site's published
// nutrition is a recipe total or already per serving (reconcileNutritionBasis).
// Fails open: when the API key is missing or upstream errors, callers silently
// skip the fallback.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CALORIENINJAS_ENDPOINT = 'https://api.calorieninjas.com/v1/nutrition';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_QUERY_LENGTH = 1800; // CalorieNinjas accepts ~2000 chars per request

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

interface RequestBody {
  ingredients?: unknown;
  servings?: unknown;
  title?: unknown;
}

interface ValidatedInput {
  ingredients: string[];
  servings: number;
}

function validate(body: RequestBody): ValidatedInput | { error: string } {
  if (!Array.isArray(body.ingredients)) return { error: 'ingredients must be an array' };
  const ingredients = body.ingredients
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ingredients.length === 0) return { error: 'ingredients must be a non-empty array of strings' };
  let servings = 1;
  if (typeof body.servings === 'number' && Number.isFinite(body.servings) && body.servings > 0) {
    servings = Math.max(1, Math.round(body.servings));
  }
  return { ingredients, servings };
}

interface CalorieNinjasItem {
  name?: string;
  calories?: number;
  protein_g?: number;
  carbohydrates_total_g?: number;
  fat_total_g?: number;
  serving_size_g?: number;
}

interface CalorieNinjasResponse {
  items?: CalorieNinjasItem[];
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Defense-in-depth: CalorieNinjas occasionally returns physically impossible
// figures for a single food (e.g. a misparsed quantity yielding ~1900 cal /
// 150 g fat). Drop an item when its macro energy contradicts its calories, or
// when it implies an absurd portion.
const MACRO_TOLERANCE = 1.25; // allow Atwater estimate to exceed calories by 25%
const MAX_ITEM_CALORIES = 1500; // no single ingredient should exceed this
const MAX_ITEM_SERVING_G = 2000; // ~implausible portion for one ingredient

function isPlausibleItem(it: CalorieNinjasItem): boolean {
  const calories = num(it.calories);
  const protein = num(it.protein_g);
  const carbs = num(it.carbohydrates_total_g);
  const fat = num(it.fat_total_g);

  if (calories > MAX_ITEM_CALORIES) return false;
  if (num(it.serving_size_g) > MAX_ITEM_SERVING_G) return false;

  // Atwater: 4 cal/g protein & carb, 9 cal/g fat. If the macros imply far more
  // energy than the reported calories, the quantity was misparsed.
  const atwater = protein * 4 + carbs * 4 + fat * 9;
  if (calories > 0 && atwater > calories * MACRO_TOLERANCE + 50) return false;

  return true;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// CalorieNinjas treats commas as separators; joining the ingredient list with
// commas gives one parsed item per ingredient in the response.
function buildQuery(ingredients: string[]): string {
  const joined = ingredients.join(', ');
  if (joined.length <= MAX_QUERY_LENGTH) return joined;
  // Truncate at a comma boundary to keep the parser happy.
  const cut = joined.lastIndexOf(', ', MAX_QUERY_LENGTH);
  return cut > 0 ? joined.slice(0, cut) : joined.slice(0, MAX_QUERY_LENGTH);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, kind: 'method-not-allowed' });
  }

  let raw: RequestBody;
  try {
    raw = await req.json();
  } catch {
    return json(200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  const validated = validate(raw);
  if ('error' in validated) {
    return json(200, { ok: false, kind: 'bad-request', message: validated.error });
  }

  const apiKey = Deno.env.get('CALORIENINJAS_API_KEY');
  if (!apiKey) {
    return json(200, { ok: false, kind: 'not-configured', message: 'CalorieNinjas API key not set' });
  }

  const query = buildQuery(validated.ingredients);
  const url = `${CALORIENINJAS_ENDPOINT}?query=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return json(200, {
        ok: false,
        kind: 'upstream',
        status: res.status,
        message: text ? text.slice(0, 300) : `CalorieNinjas HTTP ${res.status}`,
      });
    }
    const data = (await res.json()) as CalorieNinjasResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let itemsSkipped = 0;
    for (const it of items) {
      if (!isPlausibleItem(it)) {
        itemsSkipped += 1;
        continue;
      }
      totalCalories += num(it.calories);
      totalProtein += num(it.protein_g);
      totalCarbs += num(it.carbohydrates_total_g);
      totalFat += num(it.fat_total_g);
    }
    const s = validated.servings;
    return json(200, {
      ok: true,
      itemsMatched: items.length - itemsSkipped,
      itemsSkipped,
      perRecipe: {
        calories: Math.round(totalCalories),
        proteinG: round1(totalProtein),
        carbsG: round1(totalCarbs),
        fatG: round1(totalFat),
      },
      perServing: {
        calories: Math.round(totalCalories / s),
        proteinG: round1(totalProtein / s),
        carbsG: round1(totalCarbs / s),
        fatG: round1(totalFat / s),
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return json(200, { ok: false, kind: 'timeout', message: 'CalorieNinjas request timed out' });
    }
    const message = err instanceof Error ? err.message : 'fetch failed';
    return json(200, { ok: false, kind: 'network', message });
  } finally {
    clearTimeout(timer);
  }
});
