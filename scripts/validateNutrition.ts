/**
 * Nutrition parsing validation harness.
 *
 * Fact-checks the recipe-import nutrition pipeline against real recipe pages
 * (delish.com by default). For each URL it:
 *   1. fetches the page (deployed `fetch-recipe` edge function),
 *   2. extracts the JSON-LD ingredients, yield, and published nutrition,
 *   3. computes an independent estimate (USDA engine when FDC_API_KEY is set,
 *      otherwise the deployed CalorieNinjas `compute-nutrition` function),
 *   4. runs reconcileNutritionBasis() to normalize the published nutrition to
 *      per serving (delish publishes some recipes as whole-recipe TOTALS),
 *   5. prints site-vs-engine per-serving numbers and the % error.
 *
 * The DISPLAYED value uses the site's own numbers (basis-corrected), so it tracks
 * the site within rounding; the engine column is the independent cross-check.
 *
 * Usage:
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx tsx scripts/validateNutrition.ts --limit 15
 *   # USDA engine (more accurate cross-check; needs a free data.gov key):
 *   FDC_API_KEY=... npx tsx scripts/validateNutrition.ts --limit 6 --engine usda
 */
import {
  extractJsonLdBlocks,
  findRecipeNode,
  parseNutrition,
  reconcileNutritionBasis,
} from '../src/utils/recipeUrlParser';
import { parseIngredient } from '../src/utils/ingredientParser';
import { normalizeName } from '../src/utils/normalizeName';
import { coreFoodName, estimateNutrition as estimateFromProvider, FoodNutrition, FoodProvider } from '../src/utils/nutritionEstimator';
import type { NutritionPerServing } from '../src/types';
import type { NutritionEstimate } from '../src/utils/computeNutrition';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Curated savory mains/sides (more reliably carry full nutrition + parseable
// ingredients). Includes the two reference recipes: steak fajita (publishes a
// recipe TOTAL) and tuscan tortellini (publishes per serving).
const DEFAULT_URLS = [
  'https://www.delish.com/cooking/recipe-ideas/recipes/a57495/steak-fajita-power-bowls-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a47091/tuscan-tortellini-salad-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a49488/slow-cooker-bolognese-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a55654/best-broiled-salmon-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a55917/chicken-bacon-ranch-casserole-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a48012/flank-steak-with-watermelon-salad-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a47376/grilled-salmon-with-pineapple-salsa-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a55213/shrimp-fajitas-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a49318/ginger-glazed-pork-chops-with-brussels-sprouts-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a52647/whole-roasted-cauliflower-tomatoes-and-garlic-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a45954/spicy-ginger-chicken-steamed-bok-choy-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a52659/blue-cheese-burgers-with-caramelized-onions-and-crispy-rosemary-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a55259/enchilada-stuffed-shells-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a57995/avocado-mac-cheese-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a55258/slow-cooker-pizza-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a47335/bruschetta-pasta-salad-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a49364/waffle-fry-pot-pie-recipe/',
  'https://www.delish.com/cooking/recipe-ideas/recipes/a45223/grinch-jell-o-shots-recipe/',
];

interface Args {
  limit: number;
  engine: 'usda' | 'calorieninjas';
  urls: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit = 15;
  let engine: 'usda' | 'calorieninjas' = 'usda';
  const urls: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = Number(argv[++i]);
    else if (argv[i] === '--engine') engine = argv[++i] as Args['engine'];
    else if (argv[i].startsWith('http')) urls.push(argv[i]);
  }
  return { limit, engine, urls: urls.length ? urls : DEFAULT_URLS };
}

interface SiteRecipe {
  title: string;
  servings: number;
  ingredients: string[];
  site: Partial<NutritionPerServing>;
}

async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-recipe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as { ok?: boolean; html?: string };
  return data.ok && typeof data.html === 'string' ? data.html : null;
}

function parseYield(raw: unknown): number {
  if (typeof raw === 'number') return Math.max(1, Math.round(raw));
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const n = parseYield(v);
      if (n) return n;
    }
  }
  if (typeof raw === 'string') {
    const range = raw.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/i);
    if (range) return Math.max(1, Math.round((+range[1] + +range[2]) / 2));
    const m = raw.match(/\d+/);
    if (m) return Math.max(1, parseInt(m[0], 10));
  }
  return 4;
}

function extractRecipe(html: string): SiteRecipe | null {
  const { blocks } = extractJsonLdBlocks(html);
  const node = findRecipeNode(blocks);
  if (!node) return null;
  const ingredients = Array.isArray(node.recipeIngredient)
    ? (node.recipeIngredient as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const servings = parseYield(node.recipeYield);
  const nutritionNode = node.nutrition;
  const site: Partial<NutritionPerServing> = {};
  if (nutritionNode && typeof nutritionNode === 'object' && !Array.isArray(nutritionNode)) {
    const parsed = parseNutrition(nutritionNode as Record<string, unknown>);
    if (parsed.values) {
      for (const k of ['calories', 'proteinG', 'carbsG', 'fatG'] as const) {
        if (!parsed.missing.includes(k)) site[k] = parsed.values[k];
      }
    }
  }
  const title = typeof node.name === 'string' ? node.name : 'Untitled';
  return { title, servings, ingredients, site };
}

// --- Independent estimate: CalorieNinjas (deployed) -----------------------
async function estimateCalorieNinjas(ings: string[], servings: number): Promise<NutritionEstimate | null> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/compute-nutrition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ ingredients: ings, servings }),
  });
  const data = (await res.json()) as { ok?: boolean; perRecipe?: NutritionPerServing; perServing?: NutritionPerServing };
  if (!data.ok || !data.perRecipe || !data.perServing) return null;
  return { perRecipe: data.perRecipe, perServing: data.perServing };
}

// --- Independent estimate: deployed usda-nutrition edge function -----------
// Mirrors the app's real path (src/utils/computeNutrition.estimateNutrition):
// ask the edge function to resolve unique names, then sum client-side with the
// pure estimator. Uses the FDC_API_KEY secret on the server, so no local key.
async function estimateUsda(ings: string[], servings: number): Promise<NutritionEstimate | null> {
  const parsed = ings.map(parseIngredient).filter((p) => p.name);
  const names = Array.from(new Set(parsed.map((p) => normalizeName(coreFoodName(p.name)))));
  const res = await fetch(`${SUPABASE_URL}/functions/v1/usda-nutrition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ foods: names }),
  });
  const data = (await res.json()) as { ok?: boolean; foods?: Array<{ name: string; per100g: NutritionPerServing; portions?: Record<string, number> }> };
  if (!data.ok || !Array.isArray(data.foods)) return null;
  const map = new Map<string, FoodNutrition>();
  for (const f of data.foods) if (f?.name && f.per100g) map.set(f.name, { per100g: f.per100g, portions: f.portions });
  const provider: FoodProvider = (norm) => map.get(norm) ?? null;
  const est = estimateFromProvider(parsed, servings, provider);
  if (est.itemsMatched === 0 || est.perRecipe.calories <= 0) return null;
  return { perRecipe: est.perRecipe, perServing: est.perServing };
}

// --- Reporting -------------------------------------------------------------
function pct(a: number, b: number): number {
  if (!b) return NaN;
  return ((a - b) / b) * 100;
}

const MACROS: Array<[keyof NutritionPerServing, string]> = [
  ['calories', 'cal'],
  ['proteinG', 'pro'],
  ['carbsG', 'carb'],
  ['fatG', 'fat'],
];

async function main() {
  const args = parseArgs();
  if (!SUPABASE_URL || !ANON) {
    console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    process.exit(1);
  }
  console.log(`Engine: ${args.engine}${args.engine === 'usda' ? ' (deployed usda-nutrition edge function)' : ' (deployed compute-nutrition / CalorieNinjas)'}`);
  console.log(`Validating up to ${args.limit} recipes...\n`);

  let ok = 0;
  let totalsDetected = 0;
  const errAbs: Record<string, number[]> = { cal: [], pro: [], carb: [], fat: [] };
  const basisFlags: string[] = [];

  for (const url of args.urls) {
    if (ok >= args.limit) break;
    let html: string | null = null;
    try {
      html = await fetchHtml(url);
    } catch {
      /* ignore */
    }
    const slug = url.split('/').filter(Boolean).slice(-1)[0];
    if (!html) {
      console.log(`SKIP  ${slug} (fetch failed)`);
      continue;
    }
    const rec = extractRecipe(html);
    if (!rec || rec.ingredients.length === 0 || typeof rec.site.calories !== 'number') {
      console.log(`SKIP  ${slug} (no ingredients/nutrition)`);
      continue;
    }

    let estimate: NutritionEstimate | null = null;
    try {
      estimate = args.engine === 'usda'
        ? await estimateUsda(rec.ingredients, rec.servings)
        : await estimateCalorieNinjas(rec.ingredients, rec.servings);
    } catch (e) {
      console.log(`SKIP  ${slug} (estimate error: ${(e as Error).message})`);
      continue;
    }

    const corrected = reconcileNutritionBasis(rec.site, rec.servings, estimate);
    const wasTotal = corrected.calories !== rec.site.calories;
    if (wasTotal) totalsDetected += 1;
    ok += 1;

    console.log(`\n[${ok}] ${rec.title}  (yield ${rec.servings})  ${slug}`);
    console.log(`     basis: ${wasTotal ? 'RECIPE TOTAL → ÷servings' : 'already per-serving'}`);
    const head = '         ' + MACROS.map(([, l]) => l.padStart(8)).join('');
    console.log(head);
    console.log(
      '  site/sv' + MACROS.map(([k]) => String(Math.round((corrected[k] ?? 0) as number)).padStart(8)).join(''),
    );
    if (estimate) {
      console.log(
        '  engine ' + MACROS.map(([k]) => String(Math.round(estimate!.perServing[k])).padStart(8)).join(''),
      );
      console.log(
        '  err%   ' +
          MACROS.map(([k]) => {
            const e = pct(estimate!.perServing[k], (corrected[k] ?? 0) as number);
            return (Number.isFinite(e) ? e.toFixed(0) + '%' : '-').padStart(8);
          }).join(''),
      );
      // sanity: basis pick should leave engine within ~2.5x of displayed
      for (const [k, l] of MACROS) {
        const disp = (corrected[k] ?? 0) as number;
        const eng = estimate.perServing[k];
        if (disp > 0 && eng > 0) errAbs[l].push(Math.abs(pct(eng, disp)));
      }
      const ratio = estimate.perServing.calories / Math.max(1, (corrected.calories ?? 0) as number);
      if (ratio > 2.5 || ratio < 0.4) {
        basisFlags.push(`${slug}: engine/displayed calorie ratio ${ratio.toFixed(2)} — basis may be wrong`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Validated ${ok} recipes; ${totalsDetected} detected as recipe TOTALS (corrected), ${ok - totalsDetected} already per-serving.`);
  for (const [, l] of MACROS) {
    const arr = errAbs[l];
    if (!arr.length) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const within5 = arr.filter((e) => e <= 5).length;
    console.log(`  ${l.padEnd(5)} engine-vs-site mean |err| ${mean.toFixed(1)}%  (within 5%: ${within5}/${arr.length})`);
  }
  if (basisFlags.length) {
    console.log('\nBasis sanity flags:');
    for (const f of basisFlags) console.log('  ⚠ ' + f);
  } else {
    console.log('\nNo basis-detection sanity flags — every corrected per-serving stayed within ~2.5× of the engine estimate.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
