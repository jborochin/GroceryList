/**
 * Propose priceDatabase.json rows for new ingredients, from live Kroger data.
 *
 * The catalog is the enrollment list for live pricing, and every key needs a baseline
 * price before it can have one: public.price_sources.baseline_price_per_unit is NOT NULL
 * because it is the anchor sanityBand() compares candidates against. Hand-writing several
 * hundred of those is neither realistic nor accurate.
 *
 * So this resolves each proposed ingredient against the real catalog and prints what it
 * found. It DOES NOT WRITE ANYTHING — not priceDatabase.json, not Supabase. Output is a
 * review table plus a paste-ready JSON fragment; a human deletes the bad rows and commits
 * the rest. That review pass is not ceremony: a new key has no baseline yet, so the
 * sanity band cannot run on its first resolve, and a bad match here would become the
 * baseline that every future match for that ingredient is validated against.
 *
 * Usage:
 *   npm run prices:bootstrap                          # whole file, 3 stores
 *   npm run prices:bootstrap -- --limit 50            # one review-sized batch
 *   npm run prices:bootstrap -- --offset 50 --limit 50
 *   npm run prices:bootstrap -- --stores 12           # slower, better median
 *   npm run prices:bootstrap -- --json                # fragment only, for redirection
 *
 * Env: KROGER_CLIENT_ID, KROGER_CLIENT_SECRET (see supabase/README.md).
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import priceDatabase from '../../src/data/priceDatabase.json';
import purchaseProfiles from '../../src/data/purchaseProfiles.json';
import { convertMeasure } from '../../src/utils/purchaseProfile';
import { isKnownUnit } from '../../src/utils/unitConversion';
import { normalizeName } from '../../src/utils/normalizeName';
import { KROGER_REFERENCE_LOCATIONS, KrogerClient } from '../lib/krogerClient';
import { loadEnv } from '../lib/loadEnv';
import { ResolveProfile, Resolution, resolveIngredient } from '../lib/resolveIngredient';

const PROPOSALS_PATH = 'scripts/data/proposedIngredients.json';

/**
 * Stores to median across. Three rather than the weekly job's twelve: a bootstrap batch
 * is hundreds of ingredients and 12 stores each would exceed Kroger's 10,000/day quota on
 * its own. The weekly top-up supplies the more accurate median later.
 */
const DEFAULT_STORES = 3;

interface Proposal {
  /** The priceDatabase.json key to create, e.g. "ribeye steak". */
  key: string;
  /** Canonical unit to price it in. Must be a unit unitConversion knows. */
  unit: string;
  /** Existing catalog key to print a sanity ratio against, e.g. "beef steak". */
  anchor?: string;
  /** Overrides the Kroger search term when the catalog key searches badly. */
  searchTerm?: string;
}

interface PriceEntry {
  pricePerUnit: number;
  unit: string;
}

const DB = priceDatabase as Record<string, PriceEntry>;
const PROFILES = purchaseProfiles as Record<string, ResolveProfile | unknown>;

// --- validation ------------------------------------------------------------

/**
 * Reject a malformed batch before spending a single API call.
 *
 * Every check here corresponds to a failure that would otherwise surface much later:
 * a duplicate key silently overwrites, a colliding normalized name silently drops a row
 * at seed time, an unknown unit prices as unit-conflict forever.
 */
export function validateProposals(
  proposals: Proposal[],
  existing: Record<string, PriceEntry>
): string[] {
  const problems: string[] = [];
  const seenNormalized = new Map<string, string>();

  const existingNormalized = new Map<string, string>();
  for (const key of Object.keys(existing)) existingNormalized.set(normalizeName(key), key);

  for (const p of proposals) {
    if (!p.key || typeof p.key !== 'string') {
      problems.push(`entry with no key: ${JSON.stringify(p)}`);
      continue;
    }
    const normalized = normalizeName(p.key);
    if (!normalized) {
      problems.push(`"${p.key}" normalizes to an empty string`);
      continue;
    }
    if (!p.unit || !isKnownUnit(p.unit)) {
      problems.push(`"${p.key}" has unknown unit "${p.unit}"`);
    }
    if (p.anchor && existing[p.anchor] === undefined) {
      problems.push(`"${p.key}" anchors to "${p.anchor}", which is not in priceDatabase.json`);
    }
    const clash = existingNormalized.get(normalized);
    if (clash !== undefined) {
      problems.push(`"${p.key}" collides with existing catalog key "${clash}"`);
    }
    const dupe = seenNormalized.get(normalized);
    if (dupe !== undefined) {
      problems.push(`"${p.key}" and "${dupe}" both normalize to "${normalized}"`);
    }
    seenNormalized.set(normalized, p.key);
  }

  return problems;
}

/**
 * Profile to convert a SKU's pack size into the proposed unit.
 *
 * Deliberately does NOT call getProfile(): with no priceDatabase row yet, getProfile
 * falls back to findPrice, which would substring-match the new key onto some unrelated
 * existing ingredient and hand back ITS sell unit.
 */
function profileFor(key: string, unit: string): ResolveProfile {
  const explicit = PROFILES[key] ?? PROFILES[normalizeName(key)];
  if (explicit && typeof explicit === 'object' && 'sellUnit' in (explicit as object)) {
    return explicit as ResolveProfile;
  }
  return { sellUnit: unit, packSize: 1 };
}

// --- reporting -------------------------------------------------------------

interface Proposed {
  proposal: Proposal;
  resolution: Resolution;
}

export function buildReviewReport(results: Proposed[], existing: Record<string, PriceEntry>): string {
  const ok = results.filter((r) => r.resolution.status === 'published' && r.resolution.pricePerUnit);
  const bad = results.filter((r) => r.resolution.status !== 'published');

  const lines: string[] = [
    '# Bootstrap proposals',
    '',
    `- Proposed: **${results.length}**`,
    `- Resolved: **${ok.length}**`,
    `- Unresolved (dropped, no price invented): **${bad.length}**`,
    '',
  ];

  if (ok.length > 0) {
    lines.push('## Review these before committing', '');
    lines.push('| Key | Matched SKU | Size | $/unit | vs anchor | Conf. | Pool |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const { proposal, resolution } of ok) {
      const anchor = proposal.anchor ? existing[proposal.anchor] : undefined;
      // A ratio far from 1 is not automatically wrong -- filet mignon really is ~2.5x a
      // generic steak -- but it is where a mis-matched SKU shows itself.
      //
      // Only comparable when both sides are priced in the SAME unit. Dividing $0.05/fl_oz
      // of almond milk by $4.32/gallon of milk yields "0.01x", which reads as a
      // catastrophic mismatch and is in fact a correct price.
      const ratio =
        anchor && resolution.pricePerUnit
          ? anchor.unit === resolution.unit
            ? `${(resolution.pricePerUnit / anchor.pricePerUnit).toFixed(2)}x ${proposal.anchor}`
            : `n/a (${proposal.anchor} is /${anchor.unit})`
          : '—';
      lines.push(
        `| ${proposal.key} | ${resolution.description ?? '—'} | ${resolution.size ?? '—'} | ` +
          `$${resolution.pricePerUnit?.toFixed(2)}/${resolution.unit} | ${ratio} | ` +
          `${resolution.confidence?.toFixed(2) ?? '—'} | ${resolution.poolSize ?? '—'} |`
      );
    }
    lines.push('');
  }

  if (bad.length > 0) {
    lines.push('## Unresolved — no row proposed', '');
    lines.push('| Key | Reason | Best candidate seen |');
    lines.push('| --- | --- | --- |');
    for (const { proposal, resolution } of bad) {
      lines.push(
        `| ${proposal.key} | ${resolution.status.replace('rejected:', '')} | ${resolution.description ?? '—'} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Paste-ready priceDatabase.json rows, in the file's existing formatting. */
export function buildFragment(results: Proposed[]): string {
  return results
    .filter((r) => r.resolution.status === 'published' && r.resolution.pricePerUnit)
    .map(
      ({ proposal, resolution }) =>
        `  ${JSON.stringify(proposal.key)}: { "pricePerUnit": ${resolution.pricePerUnit!.toFixed(
          2
        )}, "unit": ${JSON.stringify(resolution.unit)} },`
    )
    .join('\n');
}

// --- entry point -----------------------------------------------------------

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

async function main(): Promise<void> {
  loadEnv();
  const jsonOnly = process.argv.includes('--json');
  const log = (msg: string) => {
    if (!jsonOnly) console.log(msg);
  };

  const all = JSON.parse(
    readFileSync(resolvePath(process.cwd(), PROPOSALS_PATH), 'utf8')
  ) as Proposal[];

  const problems = validateProposals(all, DB);
  if (problems.length > 0) {
    console.error(`${PROPOSALS_PATH} has ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const offset = intArg('--offset') ?? 0;
  const limit = intArg('--limit');
  const batch = all.slice(offset, limit != null ? offset + limit : undefined);
  if (batch.length === 0) {
    throw new Error(`--offset ${offset} is past the end of ${all.length} proposals.`);
  }

  const storeCount = intArg('--stores') ?? DEFAULT_STORES;
  const locationIds = KROGER_REFERENCE_LOCATIONS.slice(0, storeCount).map((l) => l.id);

  const kroger = new KrogerClient(
    requireEnv('KROGER_CLIENT_ID'),
    requireEnv('KROGER_CLIENT_SECRET')
  );

  log(`Resolving ${batch.length} proposals across ${locationIds.length} store(s)...`);

  const results: Proposed[] = [];
  for (const [i, proposal] of batch.entries()) {
    try {
      const resolution = await resolveIngredient(
        kroger,
        {
          normalizedName: normalizeName(proposal.key),
          searchTerm: proposal.searchTerm ?? proposal.key,
          reviewed: false,
          krogerProductId: null,
          // No baseline exists yet -- that is the entire reason this ingredient is here.
          // The sanity band is skipped rather than faked, which is why a human reviews.
          baselinePricePerUnit: null,
          baselineUnit: proposal.unit,
        },
        locationIds,
        { profile: profileFor(proposal.key, proposal.unit), convertMeasure }
      );
      results.push({ proposal, resolution });
      log(
        `[${String(i + 1).padStart(3)}/${batch.length}] ${proposal.key.padEnd(26)} ` +
          `${resolution.status.padEnd(30)} ` +
          `${resolution.pricePerUnit != null ? `$${resolution.pricePerUnit.toFixed(2)}/${resolution.unit}` : ''}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 60) : 'unknown';
      log(`[${String(i + 1).padStart(3)}/${batch.length}] ${proposal.key} FAILED`);
      results.push({
        proposal,
        resolution: {
          normalizedName: normalizeName(proposal.key),
          searchTerm: proposal.key,
          reviewed: false,
          wasEnrolled: true,
          baseline: null,
          unit: proposal.unit,
          status: `rejected:error(${message})`,
        },
      });
    }
  }

  const fragment = buildFragment(results);

  if (jsonOnly) {
    console.log(fragment);
    return;
  }

  console.log(`\n${buildReviewReport(results, DB)}`);
  console.log(`Kroger API calls: ${kroger.calls}`);
  console.log('\n## Paste into src/data/priceDatabase.json after review\n');
  console.log(fragment);
  console.log(
    '\nNothing was written. After pasting, run `npm run prices:seed-sources` and apply the SQL.'
  );
}

// Only run when invoked directly, so the pure builders above stay importable by tests.
if (process.argv[1] && process.argv[1].includes('bootstrap')) {
  main().catch((err) => {
    console.error('bootstrap failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
