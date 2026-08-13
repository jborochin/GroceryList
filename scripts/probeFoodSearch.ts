/**
 * Food database probe — run the Log tab's lookup path from the CLI.
 *
 * Barcode scanning needs a camera, so it cannot be exercised on web at all and
 * cannot be exercised on Windows at all. This script covers the half that
 * matters most anyway: whether a query or a UPC resolves to sane macros. It
 * plays the same role `npm run ig:probe` plays for Instagram imports — the fast
 * loop that doesn't need a device build.
 *
 * It calls USDA FoodData Central and Open Food Facts DIRECTLY, using the same
 * shared mapping the edge function imports (src/utils/foodSearchMapping.ts), so
 * a green probe means the mapping and the upstream contract agree. It does not
 * exercise the deployed function or its cache — use `--remote` for that.
 *
 * Usage:
 *   npm run food:probe -- "chobani greek yogurt"
 *   npm run food:probe -- 0038000138416          # a barcode, detected by shape
 *   npm run food:probe -- 0038000138416 --off    # skip FDC, go straight to OFF
 *   npm run food:probe -- 173944 --detail        # household portions for one fdcId
 *   npm run food:probe -- "oats" --remote        # via the deployed function
 *   npm run food:probe -- "oats" --json          # raw mapped FoodItems
 *
 * Needs FDC_API_KEY in .env (free from https://fdc.nal.usda.gov/api-key-signup);
 * FDC_API_KEY=DEMO_KEY works for ~30 calls/hour if you only want a smoke test.
 * Open Food Facts needs no key, so --off works without one.
 */
import { mapOffProduct, mapUsdaFood, mapUsdaSearch } from '../src/utils/foodSearchMapping';
import type { FoodItem } from '../src/types';
import { loadEnv } from './lib/loadEnv';

const FDC_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const FDC_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food';
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_HEADERS = {
  'User-Agent': 'MealFlow/1.0 (https://github.com/jborochin/mealflow)',
  Accept: 'application/json',
};

interface Args {
  term: string;
  off: boolean;
  remote: boolean;
  json: boolean;
  detail: boolean;
}

function parseArgs(argv: string[]): Args {
  const rest: string[] = [];
  let off = false;
  let remote = false;
  let json = false;
  let detail = false;
  for (const arg of argv) {
    if (arg === '--off') off = true;
    else if (arg === '--remote') remote = true;
    else if (arg === '--json') json = true;
    else if (arg === '--detail') detail = true;
    else rest.push(arg);
  }
  return { term: rest.join(' ').trim(), off, remote, json, detail };
}

function isBarcode(term: string): boolean {
  return /^\d{8,14}$/.test(term);
}

function stripLeadingZeros(code: string): string {
  return code.replace(/^0+/, '') || '0';
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.log(`  ${url.replace(/api_key=[^&]+/, 'api_key=***')} → HTTP ${res.status}`);
    return null;
  }
  return await res.json();
}

async function probeLocal(args: Args): Promise<FoodItem[]> {
  const barcode = isBarcode(args.term);

  if (barcode && !args.off) {
    const apiKey = process.env.FDC_API_KEY;
    if (apiKey) {
      console.log(`FoodData Central (barcode ${args.term})…`);
      const url =
        `${FDC_SEARCH}?api_key=${apiKey}&query=${encodeURIComponent(args.term)}` +
        `&dataType=${encodeURIComponent('Branded')}&pageSize=5`;
      const items = mapUsdaSearch(await fetchJson(url));
      const target = stripLeadingZeros(args.term);
      const exact = items.find((i) => i.barcode && stripLeadingZeros(i.barcode) === target);
      if (exact) return [exact];
      console.log(
        `  no exact gtinUpc match among ${items.length} result(s) — falling back to Open Food Facts`,
      );
    } else {
      console.log('FDC_API_KEY not set — skipping FoodData Central');
    }
  }

  if (barcode) {
    console.log(`Open Food Facts (barcode ${args.term})…`);
    const fields = 'code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments';
    const url = `${OFF_PRODUCT}/${encodeURIComponent(args.term)}.json?fields=${fields}`;
    const item = mapOffProduct(await fetchJson(url, OFF_HEADERS));
    return item ? [item] : [];
  }

  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FDC_API_KEY is not set. Add it to .env (free key: https://fdc.nal.usda.gov/api-key-signup).\n' +
        'FDC_API_KEY=DEMO_KEY works for a handful of calls per hour if you just want a smoke test.',
    );
  }

  // Mirrors the edge function: two queries, not one. A combined
  // `dataType=Branded,Foundation,SR Legacy` returns only SR Legacy rows — see
  // the searchUsda comment in supabase/functions/food-search/index.ts.
  console.log(`FoodData Central (search "${args.term}")…`);
  const [generic, branded] = await Promise.all([
    fetchJson(
      `${FDC_SEARCH}?api_key=${apiKey}&query=${encodeURIComponent(args.term)}` +
        `&dataType=${encodeURIComponent('Foundation,SR Legacy')}&pageSize=6`,
    ),
    fetchJson(
      `${FDC_SEARCH}?api_key=${apiKey}&query=${encodeURIComponent(args.term)}` +
        `&dataType=${encodeURIComponent('Branded')}&pageSize=25`,
    ),
  ]);

  const genericItems = mapUsdaSearch(generic);
  const brandedItems = mapUsdaSearch(branded);
  console.log(`  ${genericItems.length} generic, ${brandedItems.length} branded`);

  const out: FoodItem[] = [];
  const seen = new Set<string>();
  for (const item of [...genericItems, ...brandedItems]) {
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    out.push(item);
    if (out.length >= 25) break;
  }
  return out;
}

/**
 * The lazy portion fetch the serving picker makes. Worth probing separately:
 * it is the only way a whole food gets "1 medium" instead of grams, and it uses
 * a different endpoint (and a different payload shape) from search.
 */
async function probeDetail(fdcId: string): Promise<FoodItem[]> {
  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) throw new Error('FDC_API_KEY is not set.');
  console.log(`FoodData Central (detail ${fdcId})…`);
  const payload = await fetchJson(`${FDC_DETAIL}/${encodeURIComponent(fdcId)}?api_key=${apiKey}`);
  const item = payload ? mapUsdaFood(payload as Record<string, unknown>) : null;
  return item ? [item] : [];
}

async function probeRemote(args: Args): Promise<FoodItem[]> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('--remote needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const body = isBarcode(args.term) ? { barcode: args.term } : { query: args.term };
  console.log(`food-search function (${JSON.stringify(body)})…`);
  const res = await fetch(`${url}/functions/v1/food-search`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { ok?: boolean; message?: string; foods?: FoodItem[]; cached?: boolean };
  if (!payload.ok) throw new Error(payload.message ?? `function returned HTTP ${res.status}`);
  if (payload.cached) console.log('  (served from public.food_cache)');
  return payload.foods ?? [];
}

function printItem(item: FoodItem, index: number): void {
  const n = item.per100g;
  const brand = item.brand ? ` — ${item.brand}` : '';
  const upc = item.barcode ? `  upc ${item.barcode}` : '';
  console.log(`\n${String(index + 1).padStart(2)}. ${item.name}${brand}`);
  console.log(`    ${item.source}:${item.sourceId}${upc}`);
  if (n) {
    console.log(
      `    per 100 g: ${Math.round(n.calories)} kcal  ` +
        `P ${n.proteinG.toFixed(1)}  C ${n.carbsG.toFixed(1)}  F ${n.fatG.toFixed(1)}`,
    );
  }
  if (item.servings.length > 0) {
    const servings = item.servings
      .slice(0, 4)
      // Many labels already state their own weight ("1 serving (28 g)").
      .map((s) => (s.label.includes(String(s.grams)) ? s.label : `${s.label} (${s.grams} g)`))
      .join(', ');
    console.log(`    servings: ${servings}`);
  } else {
    console.log('    servings: none published — the picker will offer grams only');
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.term) {
    console.error('Usage: npm run food:probe -- <query|barcode> [--off] [--remote] [--json]');
    process.exit(1);
  }

  const foods = args.detail
    ? await probeDetail(args.term)
    : args.remote
    ? await probeRemote(args)
    : await probeLocal(args);

  if (args.json) {
    console.log(JSON.stringify(foods, null, 2));
    return;
  }

  if (foods.length === 0) {
    console.log('\nNo usable match.');
    if (isBarcode(args.term)) {
      console.log('In the app this routes to "add it as a custom food" — a routine outcome.');
    }
    return;
  }

  console.log(`\n${foods.length} result(s):`);
  foods.forEach(printItem);

  const withoutServings = foods.filter((f) => f.servings.length === 0).length;
  if (withoutServings > 0) {
    console.log(
      `\n${withoutServings}/${foods.length} carry no household serving. That is expected for ` +
        'many Foundation rows; the serving picker falls back to grams.',
    );
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
