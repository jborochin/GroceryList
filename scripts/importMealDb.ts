/**
 * TheMealDB → `public.meals` importer.
 *
 * Pulls recipes from the free TheMealDB API, transforms each into a row matching
 * the `meals` table (see supabase/schema.sql). By default it writes an idempotent
 * SQL file you paste into the Supabase SQL editor; with --upsert it writes the
 * rows straight to the table using the service-role key (which bypasses RLS —
 * the `meals` table is public-read with NO client write policy, so seeding must
 * go through the SQL editor or the service role; see CLAUDE.md security notes).
 *
 * Nutrition is sourced from the deployed `compute-nutrition` edge function so the
 * CalorieNinjas key stays server-side; only the public anon key is used here.
 *
 * Usage:
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx tsx scripts/importMealDb.ts --areas Italian,Mexican,Thai --limit 8
 *
 *   # Direct seed (service-role key — keep it out of the client bundle / git):
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/importMealDb.ts --areas Italian --limit 8 --upsert
 *
 * Flags:
 *   --areas A,B,C   TheMealDB areas to pull (default: a curated set covering the
 *                   app's 11 cuisines)
 *   --limit N       Max meals per area (default 8)
 *   --servings N    Servings the recipe quantities describe when not detectable
 *                   from the instructions (default 4)
 *   --out PATH      Output SQL path (default supabase/seed/mealdb_import.sql)
 *   --upsert        Write rows directly to the `meals` table via the service-role
 *                   key (SUPABASE_SERVICE_ROLE_KEY) instead of emitting SQL
 *   --skip-nutrition  Emit zeroed nutrition + a TODO marker instead of calling
 *                     the edge function (rows still need manual macros)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseIngredient } from '../src/utils/ingredientParser';
import type { Ingredient, MealSlot, NutritionPerServing } from '../src/types';

const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';
const REQUEST_DELAY_MS = 150; // be polite to the free endpoint

// ---------------------------------------------------------------------------
// Mappings into the app's vocabulary (src/data/foodPreferences.json keys).
// ---------------------------------------------------------------------------

// TheMealDB `strArea` → cuisine key. Unknown areas fall back to 'american'.
const AREA_TO_CUISINE: Record<string, string> = {
  Italian: 'italian',
  American: 'american',
  British: 'american',
  Canadian: 'american',
  Irish: 'american',
  Polish: 'american',
  Russian: 'american',
  Dutch: 'american',
  Ukrainian: 'american',
  Jamaican: 'american',
  Kenyan: 'american',
  Greek: 'mediterranean',
  Spanish: 'mediterranean',
  Portuguese: 'mediterranean',
  French: 'mediterranean',
  Croatian: 'mediterranean',
  Mexican: 'mexican',
  Chinese: 'asian',
  Japanese: 'asian',
  Vietnamese: 'asian',
  Malaysian: 'asian',
  Filipino: 'asian',
  Indian: 'indian',
  Thai: 'thai',
  Moroccan: 'middle_eastern',
  Egyptian: 'middle_eastern',
  Tunisian: 'middle_eastern',
  Turkish: 'middle_eastern',
};

const DEFAULT_AREAS = [
  'Italian',
  'Mexican',
  'Indian',
  'Thai',
  'Chinese',
  'Greek',
  'Moroccan',
  'American',
  'British',
  'French',
];

// Conservative keyword scans for dietary inference. We only ever ADD a
// restriction the meal clearly satisfies; allergen-frees (gluten/dairy/nut) are
// intentionally NOT auto-assigned — keyword absence is too unsafe to claim.
const MEAT_KEYWORDS = [
  'beef', 'chicken', 'pork', 'lamb', 'bacon', 'ham', 'sausage', 'turkey', 'veal',
  'goat', 'duck', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'mince', 'steak',
  'gelatin', 'lard', 'meat', 'pepperoni',
];
const FISH_KEYWORDS = [
  'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'crab', 'lobster', 'anchovy',
  'sardine', 'haddock', 'mackerel', 'trout', 'squid', 'octopus', 'clam', 'mussel',
  'oyster', 'scallop', 'worcestershire',
];
const ANIMAL_PRODUCT_KEYWORDS = [
  'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'egg', 'honey',
  'paneer', 'custard', 'mayonnaise',
];

// ---------------------------------------------------------------------------
// TheMealDB response shapes (only the fields we read).
// ---------------------------------------------------------------------------

interface MealDbSummary {
  idMeal: string;
  strMeal: string;
}

interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strCategory: string | null;
  strArea: string | null;
  strInstructions: string | null;
  strMealThumb: string | null;
  strTags: string | null;
  [key: string]: string | null; // strIngredient1..20 / strMeasure1..20
}

interface MealRow {
  id: string;
  title: string;
  cuisine: string;
  slots: MealSlot[];
  dietaryTags: string[];
  servings: number;
  ingredients: Ingredient[];
  nutritionPerServing: NutritionPerServing;
  imageUrl: string | null;
  instructions: string[];
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  areas: string[];
  limit: number;
  servings: number;
  out: string;
  skipNutrition: boolean;
  upsert: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    areas: (get('--areas')?.split(',').map((a) => a.trim()).filter(Boolean)) ?? DEFAULT_AREAS,
    limit: Number(get('--limit') ?? 8),
    servings: Number(get('--servings') ?? 4),
    out: get('--out') ?? 'supabase/seed/mealdb_import.sql',
    skipNutrition: argv.includes('--skip-nutrition'),
    upsert: argv.includes('--upsert'),
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function listMealsByArea(area: string, limit: number): Promise<string[]> {
  const data = await fetchJson<{ meals: MealDbSummary[] | null }>(
    `${MEALDB_BASE}/filter.php?a=${encodeURIComponent(area)}`
  );
  return (data.meals ?? []).slice(0, limit).map((m) => m.idMeal);
}

async function lookupMeal(id: string): Promise<MealDbMeal | null> {
  const data = await fetchJson<{ meals: MealDbMeal[] | null }>(
    `${MEALDB_BASE}/lookup.php?i=${encodeURIComponent(id)}`
  );
  return data.meals?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// A few TheMealDB measure abbreviations the app's unitSynonyms doesn't carry.
const MEASURE_ALIASES: Record<string, string> = {
  tbs: 'tbsp',
  tblsp: 'tbsp',
  tbls: 'tbsp',
};

// TheMealDB measures glue the number to the unit ("500g", "8-ounce") and use
// odd abbreviations — normalize so parseIngredient can split them.
function normalizeMeasure(measure: string): string {
  let m = measure.toLowerCase().trim();
  m = m.replace(/(\d)[\s-]*([a-z])/g, '$1 $2'); // "500g" / "8-ounce" → "500 g" / "8 ounce"
  m = m.replace(/\b(tbs|tblsp|tbls)\b/g, (w) => MEASURE_ALIASES[w] ?? w);
  return m.replace(/\s+/g, ' ').trim();
}

interface ExtractedIngredient {
  ingredient: Ingredient; // structured row for the meals table
  line: string; // free-text "measure name" for the nutrition API
}

// TheMealDB packs ingredients across strIngredient1..20 / strMeasure1..20 and —
// crucially — keeps the clean name and the measure in separate fields. We take
// the name verbatim and parse only the measure for quantity/unit, which is far
// cleaner than re-parsing a concatenation.
function extractIngredients(meal: MealDbMeal): ExtractedIngredient[] {
  const out: ExtractedIngredient[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] ?? '').trim();
    if (!name) continue;
    const rawMeasure = (meal[`strMeasure${i}`] ?? '').trim();
    const measure = normalizeMeasure(rawMeasure);
    // Parse "<measure> <name>" but keep the clean strIngredient as the name;
    // we only trust the parser's quantity + unit.
    const parsed = parseIngredient(`${measure} ${name}`.trim());
    out.push({
      ingredient: {
        name: name.toLowerCase(),
        quantity: parsed.quantity,
        unit: parsed.unit,
      },
      line: `${rawMeasure} ${name}`.trim(),
    });
  }
  return out;
}

function detectServings(instructions: string | null, fallback: number): number {
  if (!instructions) return fallback;
  const m = instructions.match(/serv(?:es|ing|ings)?\s+(?:about\s+)?(\d{1,2})/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) return n;
  }
  return fallback;
}

function splitInstructions(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*step\s*\d+[:.)]?\s*/i, '').trim())
    .filter((s) => s.length > 0);
}

function resolveCuisine(meal: MealDbMeal): string {
  if ((meal.strCategory ?? '').toLowerCase() === 'seafood') return 'seafood';
  const area = meal.strArea ?? '';
  return AREA_TO_CUISINE[area] ?? 'american';
}

function resolveSlots(meal: MealDbMeal): MealSlot[] {
  const category = (meal.strCategory ?? '').toLowerCase();
  const title = meal.strMeal.toLowerCase();
  if (category === 'breakfast') return ['breakfast'];
  if (['dessert', 'side', 'starter'].includes(category)) return ['snack'];
  const slots = new Set<MealSlot>(['lunch', 'dinner']);
  if (/\b(smoothie|bar|bites|snack|dip)\b/.test(title)) slots.add('snack');
  return Array.from(slots);
}

function resolveDietaryTags(meal: MealDbMeal, ingredientText: string): string[] {
  const tags = new Set<string>();
  const category = (meal.strCategory ?? '').toLowerCase();
  const rawTags = (meal.strTags ?? '').toLowerCase();

  if (category === 'vegan' || rawTags.includes('vegan')) {
    tags.add('vegan');
    tags.add('vegetarian');
  }
  if (category === 'vegetarian' || rawTags.includes('vegetarian')) tags.add('vegetarian');

  const hasMeat = MEAT_KEYWORDS.some((k) => ingredientText.includes(k));
  const hasFish = FISH_KEYWORDS.some((k) => ingredientText.includes(k));
  const hasAnimalProduct = ANIMAL_PRODUCT_KEYWORDS.some((k) => ingredientText.includes(k));

  if (!hasMeat && !hasFish) tags.add('vegetarian');
  if (!hasMeat) tags.add('pescatarian'); // a no-meat meal satisfies the pescatarian filter
  if (tags.has('vegetarian') && !hasAnimalProduct) tags.add('vegan');

  return Array.from(tags);
}

// high_protein / low_carb are app preference tags derived from the macros.
function nutritionTags(n: NutritionPerServing): string[] {
  const tags: string[] = [];
  if (n.proteinG >= 25) tags.push('high_protein');
  if (n.carbsG <= 20) tags.push('low_carb');
  return tags;
}

// ---------------------------------------------------------------------------
// Nutrition via the deployed compute-nutrition edge function
// ---------------------------------------------------------------------------

const ZERO_NUTRITION: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function functionUrl(): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, '')}/functions/v1/compute-nutrition` : null;
}

async function computeNutrition(
  lines: string[],
  servings: number
): Promise<NutritionPerServing | null> {
  const url = functionUrl();
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify({ ingredients: lines, servings }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      perServing?: NutritionPerServing;
    };
    if (!data.ok || !data.perServing) return null;
    return data.perServing;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQL emission (parameterless literals for the SQL editor; idempotent upsert)
// ---------------------------------------------------------------------------

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlTextArray = (arr: string[]) =>
  arr.length === 0 ? `ARRAY[]::text[]` : `ARRAY[${arr.map(sqlStr).join(', ')}]::text[]`;
const sqlJsonb = (v: unknown) => `${sqlStr(JSON.stringify(v))}::jsonb`;
const sqlNum = (n: number) => String(n);

function rowToValues(r: MealRow): string {
  return `  (${[
    sqlStr(r.id),
    sqlStr(r.title),
    sqlStr(r.cuisine),
    sqlTextArray(r.slots),
    sqlTextArray(r.dietaryTags),
    sqlNum(r.servings),
    sqlJsonb(r.ingredients),
    sqlJsonb(r.nutritionPerServing),
    'NULL', // prep_time_minutes — TheMealDB has none
    r.imageUrl ? sqlStr(r.imageUrl) : 'NULL',
    sqlTextArray(r.instructions),
  ].join(', ')})`;
}

function buildSql(rows: MealRow[], hasZeroNutrition: boolean): string {
  const header = [
    '-- Generated by scripts/importMealDb.ts — TheMealDB import for public.meals.',
    '-- Review before running. Paste into the Supabase SQL editor (service role).',
    '-- NOTE: dietaryTags are heuristic; allergen-frees (gluten/dairy/nut) are NOT',
    '--       auto-assigned and must be added by hand where verified.',
    hasZeroNutrition
      ? '-- WARNING: some rows have zeroed nutrition (--skip-nutrition or fetch failure);'
      : null,
    hasZeroNutrition ? '--          search for "calories":0 and fill macros before relying on them.' : null,
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const columns =
    '(id, title, cuisine, slots, dietary_tags, servings, ingredients, ' +
    'nutrition_per_serving, prep_time_minutes, image_url, instructions)';

  const onConflict = [
    'on conflict (id) do update set',
    '  title = excluded.title,',
    '  cuisine = excluded.cuisine,',
    '  slots = excluded.slots,',
    '  dietary_tags = excluded.dietary_tags,',
    '  servings = excluded.servings,',
    '  ingredients = excluded.ingredients,',
    '  nutrition_per_serving = excluded.nutrition_per_serving,',
    '  prep_time_minutes = excluded.prep_time_minutes,',
    '  image_url = excluded.image_url,',
    '  instructions = excluded.instructions,',
    '  updated_at = now();',
  ].join('\n');

  return `${header}insert into public.meals\n  ${columns}\nvalues\n${rows
    .map(rowToValues)
    .join(',\n')}\n${onConflict}\n`;
}

// ---------------------------------------------------------------------------
// Direct service-role upsert (--upsert)
// ---------------------------------------------------------------------------

const UPSERT_BATCH = 100;

// Map a MealRow to the table's snake_case columns. ingredients /
// nutrition_per_serving are jsonb — supabase-js serializes the objects; the
// text[] columns take plain arrays.
function rowToRecord(r: MealRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    slots: r.slots,
    dietary_tags: r.dietaryTags,
    servings: r.servings,
    ingredients: r.ingredients,
    nutrition_per_serving: r.nutritionPerServing,
    prep_time_minutes: null, // TheMealDB has none
    image_url: r.imageUrl,
    instructions: r.instructions,
  };
}

async function upsertRows(rows: MealRow[]): Promise<void> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for --upsert.'
    );
  }
  // Service-role client: no session persistence, no auto-refresh — this is a
  // one-shot server-side tool, and the key must never reach the app bundle.
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const records = rows.map(rowToRecord);
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    const { error } = await client.from('meals').upsert(batch, { onConflict: 'id' });
    if (error) {
      throw new Error(`upsert batch ${i / UPSERT_BATCH + 1} failed: ${error.message}`);
    }
    console.log(`  upserted ${Math.min(i + batch.length, records.length)}/${records.length}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipNutrition && !functionUrl()) {
    console.error(
      'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
        'Set them so nutrition can be computed, or pass --skip-nutrition to emit zeros.'
    );
    process.exit(1);
  }
  // Fail fast on --upsert before doing any network work.
  if (args.upsert && !(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error(
      'Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for --upsert.\n' +
        'The service-role key bypasses RLS — keep it out of the client bundle and git.'
    );
    process.exit(1);
  }

  const rows: MealRow[] = [];
  const seenIds = new Set<string>();
  const skipped: string[] = [];
  let zeroNutritionCount = 0;

  for (const area of args.areas) {
    let ids: string[];
    try {
      ids = await listMealsByArea(area, args.limit);
    } catch (e) {
      console.warn(`! area "${area}" failed: ${(e as Error).message}`);
      continue;
    }
    console.log(`Area ${area}: ${ids.length} meals`);

    for (const id of ids) {
      await sleep(REQUEST_DELAY_MS);
      const meal = await lookupMeal(id).catch(() => null);
      if (!meal) {
        skipped.push(`${area}/${id} (lookup failed)`);
        continue;
      }

      const extracted = extractIngredients(meal);
      if (extracted.length === 0) {
        skipped.push(`${meal.strMeal} (no ingredients)`);
        continue;
      }

      let mealId = slugify(meal.strMeal);
      if (seenIds.has(mealId)) mealId = `${mealId}-${meal.idMeal}`;
      if (seenIds.has(mealId)) continue; // exact dup in one run
      seenIds.add(mealId);

      const ingredients = extracted.map((e) => e.ingredient);
      const lines = extracted.map((e) => e.line);
      const servings = detectServings(meal.strInstructions, args.servings);
      const ingredientText = extracted.map((e) => e.ingredient.name).join(' ').toLowerCase();

      let nutrition: NutritionPerServing;
      let hasNutrition = false;
      if (args.skipNutrition) {
        nutrition = { ...ZERO_NUTRITION };
        zeroNutritionCount++;
      } else {
        const computed = await computeNutrition(lines, servings);
        if (!computed) {
          nutrition = { ...ZERO_NUTRITION };
          zeroNutritionCount++;
          console.warn(`  · nutrition unavailable for "${meal.strMeal}" (zeroed)`);
        } else {
          nutrition = computed;
          hasNutrition = true;
        }
      }

      // Only derive macro-based tags from real nutrition — zeroed macros would
      // otherwise falsely stamp every meal low_carb.
      const dietaryTags = [
        ...resolveDietaryTags(meal, ingredientText),
        ...(hasNutrition ? nutritionTags(nutrition) : []),
      ];

      rows.push({
        id: mealId,
        title: meal.strMeal,
        cuisine: resolveCuisine(meal),
        slots: resolveSlots(meal),
        dietaryTags: Array.from(new Set(dietaryTags)),
        servings,
        ingredients,
        nutritionPerServing: nutrition,
        imageUrl: meal.strMealThumb,
        instructions: splitInstructions(meal.strInstructions),
      });
    }
  }

  if (rows.length === 0) {
    console.error('No meals imported — nothing written.');
    process.exit(1);
  }

  if (zeroNutritionCount > 0) {
    console.log(`\n${zeroNutritionCount} row(s) have zeroed nutrition — review before relying on them.`);
  }
  if (skipped.length > 0) console.log(`Skipped ${skipped.length}: ${skipped.join(', ')}`);

  if (args.upsert) {
    console.log(`\nUpserting ${rows.length} meals via service role…`);
    await upsertRows(rows);
    console.log(`Done — ${rows.length} meals written to public.meals.`);
  } else {
    const outPath = resolve(process.cwd(), args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buildSql(rows, zeroNutritionCount > 0), 'utf8');
    console.log(`\nWrote ${rows.length} meals → ${args.out}`);
    console.log('Next: review the SQL, then run it in the Supabase SQL editor.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
