/**
 * Weekly live price refresh: Kroger Products API -> public.prices.
 *
 * Reads every row of public.price_sources (seeded from priceDatabase.json by
 * scripts/buildPriceSourcesSeed.ts), resolves each ingredient to a retail SKU,
 * normalizes that SKU's price into the app's canonical unit, and publishes the
 * result as an overlay the app consults ahead of its bundled prices.
 *
 * Three properties make this safe to run unattended:
 *
 *  1. REJECTION IS SAFE. A skipped ingredient keeps its previously published
 *     price, or falls through to the bundled hand-estimate — which is the app's
 *     behavior today. Nothing breaks when a match fails.
 *  2. THE UNIT NEVER CHANGES. A published price must be expressed in the same
 *     canonical unit as the bundled row, because getProfile() derives its sell
 *     unit from the price entry and roundToPurchasable() branches on that
 *     unit's family. Any candidate that can't be converted into baseline_unit
 *     is rejected rather than published in a different unit.
 *  3. RESOLVE FIRST, WRITE ONCE. Like scripts/refreshBlsPrices.ts, every
 *     ingredient is resolved and validated before a single row is written, so a
 *     mid-run failure can't leave prices half-updated.
 *
 * Usage:
 *   npm run prices:refresh-kroger -- --dry-run    # resolve + report, write nothing
 *   npm run prices:refresh-kroger
 *
 * Env:
 *   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET       Kroger developer app credentials
 *   KROGER_LOCATION_IDS                          comma-separated reference store IDs
 *                                                (find them with `npm run prices:find-locations <zip>`)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      service role — never ships in the app
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { KrogerClient, extractPrice } from './lib/krogerClient';
import { loadEnv } from './lib/loadEnv';
import {
  MIN_CONFIDENCE,
  descriptionSpecificity,
  median,
  parseSize,
  sanityBand,
  scoreMatch,
} from './lib/krogerMatch';
import { convertMeasure, getProfile } from '../src/utils/purchaseProfile';

const SOURCE = 'kroger';

interface PriceSourceRow {
  normalized_name: string;
  search_term: string;
  kroger_product_id: string | null;
  reviewed: boolean;
  baseline_price_per_unit: number;
  baseline_unit: string;
}

interface Resolution {
  normalizedName: string;
  searchTerm: string;
  reviewed: boolean;
  wasEnrolled: boolean; // had no pinned product id before this run
  productId?: string;
  description?: string;
  size?: string;
  confidence?: number;
  pricePerUnit?: number;
  baseline: number;
  unit: string;
  status: 'published' | `rejected:${string}` | 'unresolved';
}

// --- resolution ------------------------------------------------------------

/**
 * Turn a SKU's shelf price into a price per the app's canonical unit.
 *
 * e.g. $4.79 for "16 oz" of a key whose baseline unit is `lb`
 *      -> 16 oz = 1 lb -> $4.79/lb
 *
 * Uses the same two-step conversion order as estimatePriceForItem(): plain
 * convert() within a unit family, then convertMeasure()'s grams bridge for
 * cross-family cases (a cheese block priced per lb). Returns null when neither
 * can land the size in the baseline unit — the invariant that keeps rounding
 * behavior stable.
 */
export function toPricePerBaselineUnit(
  shelfPrice: number,
  size: { qty: number; unit: string },
  normalizedName: string,
  baselineUnit: string
): number | null {
  const profile = getProfile(normalizedName);
  const qtyInBaseline = convertMeasure(size.qty, size.unit, baselineUnit, profile);
  if (qtyInBaseline === null || !Number.isFinite(qtyInBaseline) || qtyInBaseline <= 0) return null;
  return shelfPrice / qtyInBaseline;
}

async function resolveOne(
  kroger: KrogerClient,
  row: PriceSourceRow,
  locationIds: string[]
): Promise<Resolution> {
  const base: Resolution = {
    normalizedName: row.normalized_name,
    searchTerm: row.search_term,
    reviewed: row.reviewed,
    wasEnrolled: !row.kroger_product_id,
    baseline: row.baseline_price_per_unit,
    unit: row.baseline_unit,
    status: 'unresolved',
  };

  // A reviewed mapping pins its SKU and is never re-searched, so review work is
  // permanent. Unreviewed rows re-search every run, which self-heals when a SKU
  // is discontinued.
  let productId = row.reviewed ? row.kroger_product_id : null;
  let description: string | undefined;
  let confidence: number | undefined;

  if (!productId) {
    const candidates = await kroger.searchProducts(row.search_term, locationIds[0]);
    let best: { product: (typeof candidates)[number]; score: number; specificity: number } | null = null;
    for (const product of candidates) {
      const score = scoreMatch(row.search_term, product.description);
      if (score === 0) continue;
      const specificity = descriptionSpecificity(product.description);
      // Highest score wins; among equal scores prefer the plainest description,
      // which keeps prepared/deli SKUs from beating the whole ingredient.
      const better = !best || score > best.score || (score === best.score && specificity < best.specificity);
      if (better) best = { product, score, specificity };
    }
    if (!best) return { ...base, status: 'rejected:no-candidate' };

    productId = best.product.productId;
    description = best.product.description;
    confidence = best.score;

    if (!row.reviewed && best.score < MIN_CONFIDENCE) {
      return {
        ...base,
        productId,
        description,
        confidence,
        status: `rejected:low-confidence(${best.score.toFixed(2)})`,
      };
    }
  }

  // Same SKU across every reference store; price varies, size does not.
  const prices: number[] = [];
  let size: string | undefined;
  for (const locationId of locationIds) {
    const product = await kroger.getProduct(productId, locationId);
    if (!product) continue;
    description = description ?? product.description;
    confidence = confidence ?? scoreMatch(row.search_term, product.description);
    const extracted = extractPrice(product);
    if (!extracted) continue;
    prices.push(extracted.price);
    size = size ?? extracted.size;
  }

  const shelfPrice = median(prices);
  if (shelfPrice === null || !size) {
    return { ...base, productId, description, confidence, status: 'rejected:no-price' };
  }

  const parsed = parseSize(size);
  if (!parsed) {
    return { ...base, productId, description, size, confidence, status: 'rejected:unparseable-size' };
  }

  const pricePerUnit = toPricePerBaselineUnit(
    shelfPrice,
    parsed,
    row.normalized_name,
    row.baseline_unit
  );
  if (pricePerUnit === null) {
    return { ...base, productId, description, size, confidence, status: 'rejected:unit-conflict' };
  }

  if (!sanityBand(pricePerUnit, row.baseline_price_per_unit, row.reviewed)) {
    const ratio = (pricePerUnit / row.baseline_price_per_unit).toFixed(1);
    return {
      ...base,
      productId,
      description,
      size,
      confidence,
      pricePerUnit,
      status: `rejected:out-of-band(${ratio}x)`,
    };
  }

  return {
    ...base,
    productId,
    description,
    size,
    confidence,
    pricePerUnit: round2(pricePerUnit),
    status: 'published',
  };
}

// --- persistence -----------------------------------------------------------

async function publish(
  supabase: SupabaseClient,
  resolutions: Resolution[],
  asOf: string
): Promise<void> {
  const published = resolutions.filter((r) => r.status === 'published' && r.pricePerUnit != null);

  if (published.length > 0) {
    const { error } = await supabase.from('prices').upsert(
      published.map((r) => ({
        normalized_name: r.normalizedName,
        price_per_unit: r.pricePerUnit,
        unit: r.unit,
        source: SOURCE,
        confidence: r.confidence ?? null,
        as_of: asOf,
      })),
      { onConflict: 'normalized_name' }
    );
    if (error) throw new Error(`Failed to upsert public.prices: ${error.message}`);
  }

  // Record outcomes on every row, including rejections — this is the review
  // queue. Rejected rows keep whatever price was published previously.
  for (const r of resolutions) {
    const { error } = await supabase
      .from('price_sources')
      .update({
        kroger_product_id: r.productId ?? null,
        kroger_description: r.description ?? null,
        confidence: r.confidence ?? null,
        last_resolved_at: asOf,
        last_status: r.status,
      })
      .eq('normalized_name', r.normalizedName);
    if (error) throw new Error(`Failed to update price_sources for ${r.normalizedName}: ${error.message}`);
  }
}

// --- reporting -------------------------------------------------------------

export function buildReport(resolutions: Resolution[], apiCalls: number): string {
  const published = resolutions.filter((r) => r.status === 'published');
  const rejected = resolutions.filter((r) => r.status.startsWith('rejected'));
  const enrolled = published.filter((r) => r.wasEnrolled);

  const lines: string[] = [
    '# Live price refresh',
    '',
    `- Ingredients processed: **${resolutions.length}**`,
    `- Published: **${published.length}**`,
    `- Rejected (kept previous/bundled price): **${rejected.length}**`,
    `- Newly enrolled this run: **${enrolled.length}**`,
    `- Kroger API calls: **${apiCalls}**`,
    '',
  ];

  if (enrolled.length > 0) {
    lines.push('## Newly enrolled — review these matches', '');
    lines.push('| Ingredient | Matched SKU | Size | $/unit | Baseline | Confidence |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of enrolled) {
      lines.push(
        `| ${r.normalizedName} | ${r.description ?? '—'} | ${r.size ?? '—'} | ` +
          `$${r.pricePerUnit?.toFixed(2)}/${r.unit} | $${r.baseline.toFixed(2)}/${r.unit} | ` +
          `${r.confidence?.toFixed(2) ?? '—'} |`
      );
    }
    lines.push('');
  }

  if (rejected.length > 0) {
    lines.push('## Rejected', '');
    lines.push('| Ingredient | Reason | Matched SKU |');
    lines.push('| --- | --- | --- |');
    for (const r of rejected) {
      lines.push(`| ${r.normalizedName} | ${r.status.replace('rejected:', '')} | ${r.description ?? '—'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- entry point -----------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes('--dry-run');

  const locationIds = requireEnv('KROGER_LOCATION_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (locationIds.length === 0) {
    throw new Error('KROGER_LOCATION_IDS must list at least one store id.');
  }

  // The project URL is the same value the app already keeps in .env under its
  // Expo-public name, so fall back to it rather than making you duplicate it.
  // The service-role key has no such fallback on purpose — it must never live
  // under an EXPO_PUBLIC_ name, which would bundle it into the app.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) is not set.');

  const supabase = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const kroger = new KrogerClient(
    requireEnv('KROGER_CLIENT_ID'),
    requireEnv('KROGER_CLIENT_SECRET')
  );

  const { data, error } = await supabase
    .from('price_sources')
    .select('normalized_name, search_term, kroger_product_id, reviewed, baseline_price_per_unit, baseline_unit');
  if (error) throw new Error(`Failed to read price_sources: ${error.message}`);

  const rows = (data ?? []) as PriceSourceRow[];
  if (rows.length === 0) {
    throw new Error('price_sources is empty — run `npm run prices:seed-sources` and apply the SQL first.');
  }

  console.log(
    `Resolving ${rows.length} ingredients across ${locationIds.length} reference store(s)${
      dryRun ? ' (dry run)' : ''
    }...`
  );

  // Resolve everything before writing anything. A single ingredient's failure
  // degrades to a rejection rather than aborting the run.
  const resolutions: Resolution[] = [];
  for (const row of rows) {
    try {
      resolutions.push(await resolveOne(kroger, row, locationIds));
    } catch (err) {
      resolutions.push({
        normalizedName: row.normalized_name,
        searchTerm: row.search_term,
        reviewed: row.reviewed,
        wasEnrolled: !row.kroger_product_id,
        baseline: row.baseline_price_per_unit,
        unit: row.baseline_unit,
        status: `rejected:error(${err instanceof Error ? err.message.slice(0, 60) : 'unknown'})`,
      });
    }
  }

  const report = buildReport(resolutions, kroger.calls);

  if (dryRun) {
    console.log(`\n${report}`);
    console.log('Dry run — nothing written.');
    return;
  }

  await publish(supabase, resolutions, new Date().toISOString());
  console.log(`\n${report}`);

  // GitHub Actions surfaces this on the run page so the review queue is visible
  // without digging through logs.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
}

if (process.argv[1] && process.argv[1].includes('refreshKrogerPrices')) {
  main().catch((err) => {
    console.error('refreshKrogerPrices failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
