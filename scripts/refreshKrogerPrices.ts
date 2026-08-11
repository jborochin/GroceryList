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
import { KROGER_REFERENCE_LOCATIONS, KrogerClient } from './lib/krogerClient';
import { loadEnv } from './lib/loadEnv';
import { Resolution, resolveIngredient } from './lib/resolveIngredient';
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

// --- resolution ------------------------------------------------------------

/**
 * Adapt a price_sources row to the shared resolver.
 *
 * The resolver itself lives in scripts/lib/resolveIngredient.ts so the weekly top-up,
 * the catalog bootstrap and the on-demand edge function all apply the same gates. Node
 * callers supply the real purchase profile; the edge function cannot, because getProfile
 * reaches findPrice and therefore fuse.js.
 */
function resolveOne(kroger: KrogerClient, row: PriceSourceRow, locationIds: string[]) {
  return resolveIngredient(
    kroger,
    {
      normalizedName: row.normalized_name,
      searchTerm: row.search_term,
      reviewed: row.reviewed,
      krogerProductId: row.kroger_product_id,
      baselinePricePerUnit: row.baseline_price_per_unit,
      baselineUnit: row.baseline_unit,
    },
    locationIds,
    { profile: getProfile(row.normalized_name) ?? undefined, convertMeasure }
  );
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
    lines.push('| Ingredient | Matched SKU | Size | $/unit | Baseline | Conf. | Pool |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of enrolled) {
      // Pool is how many priceable candidates the median was picked from — a
      // pool of 1 or 2 means the "mid-range" choice had nothing to choose from.
      lines.push(
        `| ${r.normalizedName} | ${r.description ?? '—'} | ${r.size ?? '—'} | ` +
          `$${r.pricePerUnit?.toFixed(2)}/${r.unit} | ` +
          // Null only in the bootstrap path, which prints its own report rather than this one.
          `${r.baseline === null ? '—' : `$${r.baseline.toFixed(2)}/${r.unit}`} | ` +
          `${r.confidence?.toFixed(2) ?? '—'} | ${r.poolSize ?? '—'} |`
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

function intArg(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0 || !process.argv[i + 1]) return undefined;
  const n = Number.parseInt(process.argv[i + 1], 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} expects a non-negative integer.`);
  return n;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** Tunables the top-up shares with the on-demand edge function, so retuning either
 *  is one SQL statement rather than a code change in two places. */
interface TopUpConfig {
  price_ttl_days: number;
  topup_run_call_budget: number;
  demand_promote_threshold: number;
}

const CONFIG_FALLBACK: TopUpConfig = {
  price_ttl_days: 14,
  topup_run_call_budget: 6000,
  demand_promote_threshold: 5,
};

async function loadConfig(supabase: SupabaseClient): Promise<TopUpConfig> {
  const { data } = await supabase.from('app_config').select('key, value');
  const out: TopUpConfig = { ...CONFIG_FALLBACK };
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    if (row.key in out) {
      const n = Number(row.value);
      if (Number.isFinite(n)) (out as unknown as Record<string, number>)[row.key] = n;
    }
  }
  return out;
}

/**
 * Print the ingredients people keep asking for that the catalog cannot price.
 *
 * This is the loop that grows the catalog from evidence: names accumulate in
 * ingredient_demand whenever the app asks about something with no price_sources row,
 * and the ones that clear the threshold become the next `proposedIngredients.json`
 * batch for `npm run prices:bootstrap`.
 */
async function reportDemand(supabase: SupabaseClient): Promise<void> {
  const config = await loadConfig(supabase);
  const { data, error } = await supabase
    .from('ingredient_demand')
    .select('normalized_name, request_count, first_requested_at')
    .eq('in_catalog', false)
    .eq('promoted', false)
    .gte('request_count', config.demand_promote_threshold)
    .order('request_count', { ascending: false })
    .limit(50);
  if (error || !data || data.length === 0) return;

  console.log(`\nUnpriced ingredients wanted >= ${config.demand_promote_threshold} times:`);
  for (const r of data as Array<{ normalized_name: string; request_count: number }>) {
    console.log(`  ${String(r.request_count).padStart(5)}x  ${r.normalized_name}`);
  }
  console.log('Add these to scripts/data/proposedIngredients.json and run `npm run prices:bootstrap`.\n');
}

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  // Budgeted, demand-ordered pass. This is what CI runs; the unflagged full sweep
  // stays available for a manual rebuild.
  const topUp = process.argv.includes('--top-up');

  // Defaults to the committed division spread; the env var is an escape hatch
  // for testing a different set without editing code.
  const overrideRaw: string = process.env.KROGER_LOCATION_IDS ?? '';
  const override = overrideRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const locationIds =
    override.length > 0 ? override : KROGER_REFERENCE_LOCATIONS.map((l) => l.id);
  console.log(
    override.length > 0
      ? `Using ${locationIds.length} override store(s) from KROGER_LOCATION_IDS.`
      : `Using ${locationIds.length} committed reference stores.`
  );

  // The project URL is the same value the app already keeps in .env under its
  // Expo-public name, so fall back to it rather than making you duplicate it.
  // The service-role key has no such fallback on purpose — it must never live
  // under an EXPO_PUBLIC_ name, which would bundle it into the app.
  const supabaseUrl: string | undefined =
    process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) is not set.');

  // Supabase's dashboard labels this key `service_role`, so both spellings are
  // accepted rather than making the name a thing you have to get right.
  const serviceKey: string | undefined =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE) is not set.');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
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

  const allRows = (data ?? []) as PriceSourceRow[];
  if (allRows.length === 0) {
    throw new Error('price_sources is empty — run `npm run prices:seed-sources` and apply the SQL first.');
  }

  if (topUp) {
    await reportDemand(supabase);
  }

  let rows: PriceSourceRow[];

  if (topUp) {
    // A full sweep no longer fits the quota: 349 ingredients x 12 stores is ~4,200
    // calls, and the catalog is still growing toward twice that against a
    // 10,000/day ceiling. So spend the budget on what is actually stale, most-wanted
    // first, and let the on-demand function cover the rest between runs.
    const config = await loadConfig(supabase);
    const { data: priceRows } = await supabase.from('prices').select('normalized_name, as_of');
    const asOf = new Map<string, number>();
    for (const r of (priceRows ?? []) as Array<{ normalized_name: string; as_of: string }>) {
      const t = Date.parse(r.as_of);
      if (Number.isFinite(t)) asOf.set(r.normalized_name, t);
    }

    const { data: demandRows } = await supabase
      .from('ingredient_demand')
      .select('normalized_name, request_count');
    const demand = new Map<string, number>();
    for (const r of (demandRows ?? []) as Array<{ normalized_name: string; request_count: number }>) {
      demand.set(r.normalized_name, r.request_count ?? 0);
    }

    const ttlMs = config.price_ttl_days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stale = allRows.filter((r) => {
      const t = asOf.get(r.normalized_name);
      return t === undefined || now - t > ttlMs;
    });

    // Most-requested first; among equally-wanted rows, the stalest. A never-resolved
    // row sorts ahead of any dated one.
    stale.sort((a, b) => {
      const byDemand = (demand.get(b.normalized_name) ?? 0) - (demand.get(a.normalized_name) ?? 0);
      if (byDemand !== 0) return byDemand;
      const ta = asOf.get(a.normalized_name) ?? -Infinity;
      const tb = asOf.get(b.normalized_name) ?? -Infinity;
      if (ta !== tb) return ta - tb;
      return a.normalized_name.localeCompare(b.normalized_name);
    });

    const perIngredient = Math.max(1, locationIds.length);
    const budget = Math.max(1, Math.floor(config.topup_run_call_budget / perIngredient));
    rows = stale.slice(0, budget);

    console.log(
      `Top-up: ${stale.length} of ${allRows.length} ingredients are stale past ` +
        `${config.price_ttl_days}d; budget covers ${budget} ` +
        `(${config.topup_run_call_budget} calls / ${perIngredient} per ingredient).`
    );
    if (rows.length > 0) {
      const wanted = rows.filter((r) => (demand.get(r.normalized_name) ?? 0) > 0).length;
      console.log(`  ${wanted} of the selected ${rows.length} have recorded demand.`);
    }
    if (dryRun) {
      console.log('\nWork order:');
      for (const [i, r] of rows.entries()) {
        const t = asOf.get(r.normalized_name);
        console.log(
          `  ${String(i + 1).padStart(3)}. ${r.normalized_name.padEnd(24)} ` +
            `demand=${String(demand.get(r.normalized_name) ?? 0).padStart(4)}  ` +
            `as_of=${t ? new Date(t).toISOString().slice(0, 10) : 'never'}`
        );
      }
      console.log(`\nProjected Kroger calls: ~${rows.length * perIngredient}. Nothing written.`);
      return;
    }
  } else {
    // --offset/--limit slice the work so a long run can be done in chunks that fit
    // inside a CI step or a terminal session. Ordering is stable (by primary key)
    // so chunks tile the set exactly without overlap or gaps.
    allRows.sort((a, b) => a.normalized_name.localeCompare(b.normalized_name));
    const offset = intArg('--offset') ?? 0;
    const limit = intArg('--limit');
    rows = allRows.slice(offset, limit != null ? offset + limit : undefined);
    if (rows.length === 0) {
      throw new Error(`--offset ${offset} is past the end of ${allRows.length} rows.`);
    }
  }

  if (rows.length === 0) {
    console.log('Nothing to refresh — every ingredient is inside the TTL.');
    return;
  }

  console.log(
    `Resolving ${rows.length} ingredients across ${locationIds.length} reference store(s)${
      dryRun ? ' (dry run)' : ''
    }...`
  );

  // Resolve everything before writing anything. A single ingredient's failure
  // degrades to a rejection rather than aborting the run.
  const resolutions: Resolution[] = [];
  for (const [i, row] of rows.entries()) {
    try {
      const resolved = await resolveOne(kroger, row, locationIds);
      resolutions.push(resolved);
      // Streamed per ingredient rather than buffered to the end: a full run is
      // ~15 minutes, and if it dies partway the work so far should still be
      // readable in the log instead of vanishing with the process.
      console.log(
        `[${String(i + 1).padStart(3)}/${rows.length}] ${resolved.normalizedName.padEnd(22)} ` +
          `${resolved.status.padEnd(34)} ` +
          `${resolved.pricePerUnit != null ? `$${resolved.pricePerUnit.toFixed(2)}/${resolved.unit}` : ''}`
      );
    } catch (err) {
      console.log(`[${String(i + 1).padStart(3)}/${rows.length}] ${row.normalized_name} FAILED`);
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
