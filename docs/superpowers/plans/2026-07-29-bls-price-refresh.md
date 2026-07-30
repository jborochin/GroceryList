# BLS Price Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual, local script that pulls current national-average grocery prices from the BLS Average Price API and overwrites the matching entries in `src/data/priceDatabase.json`, leaving everything else untouched.

**Architecture:** A pure conversion module (`scripts/lib/blsPriceMapping.ts`) holds a hardcoded table mapping ~13 `priceDatabase.json` keys to verified BLS series IDs plus a unit-conversion factor, and a function that turns one BLS series response into a converted price. A script (`scripts/refreshBlsPrices.ts`) fetches those series from the BLS API in batches, applies the conversion, and rewrites `priceDatabase.json` in place — printing an old→new diff for review. Follows the existing `scripts/buildSeedMeals.ts` / `scripts/importMealDb.ts` convention: run by hand via `npm run`, fails loudly, never partial-writes.

**Tech Stack:** TypeScript, `tsx` (already a devDependency), Node's built-in global `fetch`, Jest (`ts-jest`) for the pure-function tests.

Spec: `docs/superpowers/specs/2026-07-29-bls-price-refresh-design.md`

## Global Constraints

- TypeScript strict mode — all new code must pass `npm run typecheck` (`tsc --noEmit`).
- No new npm dependencies — use Node's global `fetch`, already available (Node 18+, same runtime `tsx` requires).
- Test files must match the existing jest `testMatch` glob `**/__tests__/**/*.test.ts` (see `package.json`).
- Scripts run from the repo root via `npm run <script>` — use paths relative to cwd (e.g. `'src/data/priceDatabase.json'`), matching `scripts/buildSeedMeals.ts`'s convention, not `__dirname`-relative resolution.
- The script must fail loudly (throw and exit non-zero) on any error and must never write a partial/half-updated `priceDatabase.json`.
- Only keys present in the `BLS_SERIES` mapping table are ever modified in `priceDatabase.json`; every other key must be byte-for-byte unchanged.

---

### Task 1: BLS series mapping table + pure conversion function

**Files:**
- Create: `scripts/lib/blsPriceMapping.ts`
- Test: `scripts/__tests__/blsPriceMapping.test.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `interface BlsMappingEntry { seriesId: string; blsUnit: string; factor: number }`
  - `const BLS_SERIES: Record<string, BlsMappingEntry>`
  - `interface BlsSeriesDataPoint { year: string; period: string; periodName: string; value: string; footnotes?: Array<{ code?: string; text?: string }> }`
  - `interface BlsSeriesResponse { seriesID: string; data: BlsSeriesDataPoint[] }`
  - `function mapBlsSeriesToPrice(series: BlsSeriesResponse | undefined | null, mapping: BlsMappingEntry): number | null`

The mapping table below uses BLS series IDs verified against FRED (which mirrors the BLS Average Price program) on 2026-07-29:

| `priceDatabase.json` key | BLS series ID | BLS unit | factor | app unit (unchanged) |
|---|---|---|---|---|
| `ground beef` | `APU0000703112` | lb | 1 | lb |
| `bacon` | `APU0000704111` | lb | 1 | lb |
| `chicken breast` | `APU0000FF1101` | lb (boneless) | 1 | lb |
| `eggs` | `APU0000708111` | dozen | 1/12 | each |
| `milk` | `APU0000709112` | gallon | 1 | gallon |
| `butter` | `APU0000FS1101` | lb | 1 | lb |
| `cheddar cheese` | `APU0000710212` | lb | 1 | lb |
| `banana` | `APU0000711211` | lb | 1 | lb |
| `potato` | `APU0000712112` | lb | 1 | lb |
| `tomato` | `APU0000712311` | lb (field grown) | 1 | lb |
| `flour` | `APU0000701111` | lb | 1 | lb |
| `sugar` | `APU0000715211` | lb | 1 | lb |
| `rice` | `APU0000701312` | lb (uncooked, long grain) | 1 | lb |

That's 13 entries — fewer than the spec's illustrative "15-25", because those are the keys where a real, currently-active, unambiguous BLS national series exists. (BLS also tracks a few other items — e.g. bread, orange juice, coffee — but their BLS unit doesn't cleanly factor-convert to this app's unit for that key, or the app has no matching key at all, so they're excluded rather than forced with an invented conversion.)

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/blsPriceMapping.test.ts`:

```ts
import {
  mapBlsSeriesToPrice,
  BlsSeriesResponse,
  BlsMappingEntry,
} from '../lib/blsPriceMapping';

function seriesWith(...points: Array<{ period: string; value: string }>): BlsSeriesResponse {
  return {
    seriesID: 'TEST0000000000',
    data: points.map((p) => ({
      year: '2026',
      period: p.period,
      periodName: 'Test',
      value: p.value,
    })),
  };
}

describe('mapBlsSeriesToPrice', () => {
  it('applies a factor of 1 for a direct unit match (lb -> lb)', () => {
    const series = seriesWith({ period: 'M06', value: '5.878' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBe(5.88);
  });

  it('applies a fractional factor for a unit conversion (dozen -> each)', () => {
    const series = seriesWith({ period: 'M06', value: '3.60' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000708111', blsUnit: 'dozen', factor: 1 / 12 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBe(0.3);
  });

  it('skips a non-monthly period (M13 annual average) and uses the next monthly point', () => {
    const series = seriesWith({ period: 'M13', value: '5.50' }, { period: 'M05', value: '5.60' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBe(5.6);
  });

  it('returns null for an empty data array', () => {
    const series: BlsSeriesResponse = { seriesID: 'APU0000703112', data: [] };
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBeNull();
  });

  it('returns null when no data point has a parseable numeric value', () => {
    const series = seriesWith({ period: 'M06', value: '-' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBeNull();
  });

  it('returns null for a null or undefined series', () => {
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(null, mapping)).toBeNull();
    expect(mapBlsSeriesToPrice(undefined, mapping)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scripts/__tests__/blsPriceMapping.test.ts`
Expected: FAIL — `Cannot find module '../lib/blsPriceMapping'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `scripts/lib/blsPriceMapping.ts`**

```ts
/**
 * BLS Average Price series -> priceDatabase.json key mapping.
 *
 * Each entry pins the BLS series ID for a national-average grocery price
 * (https://api.bls.gov/publicAPI/v2/timeseries/data/) plus a `factor` that
 * converts BLS's reporting unit into whatever unit that key already uses in
 * src/data/priceDatabase.json. The app's canonical unit for a key never
 * changes -- only its price -- so `factor` is a plain scalar (e.g.
 * dozen -> each is 1/12), not a full unit-conversion system.
 */

export interface BlsMappingEntry {
  seriesId: string;
  blsUnit: string; // documentation only -- the unit BLS reports the price in
  factor: number; // multiply BLS's per-blsUnit price by this to match the app's unit
}

export const BLS_SERIES: Record<string, BlsMappingEntry> = {
  'ground beef': { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 },
  bacon: { seriesId: 'APU0000704111', blsUnit: 'lb', factor: 1 },
  'chicken breast': { seriesId: 'APU0000FF1101', blsUnit: 'lb', factor: 1 },
  eggs: { seriesId: 'APU0000708111', blsUnit: 'dozen', factor: 1 / 12 },
  milk: { seriesId: 'APU0000709112', blsUnit: 'gallon', factor: 1 },
  butter: { seriesId: 'APU0000FS1101', blsUnit: 'lb', factor: 1 },
  'cheddar cheese': { seriesId: 'APU0000710212', blsUnit: 'lb', factor: 1 },
  banana: { seriesId: 'APU0000711211', blsUnit: 'lb', factor: 1 },
  potato: { seriesId: 'APU0000712112', blsUnit: 'lb', factor: 1 },
  tomato: { seriesId: 'APU0000712311', blsUnit: 'lb', factor: 1 },
  flour: { seriesId: 'APU0000701111', blsUnit: 'lb', factor: 1 },
  sugar: { seriesId: 'APU0000715211', blsUnit: 'lb', factor: 1 },
  rice: { seriesId: 'APU0000701312', blsUnit: 'lb', factor: 1 },
};

export interface BlsSeriesDataPoint {
  year: string;
  period: string;
  periodName: string;
  value: string;
  footnotes?: Array<{ code?: string; text?: string }>;
}

export interface BlsSeriesResponse {
  seriesID: string;
  data: BlsSeriesDataPoint[];
}

// Matches BLS monthly period codes M01-M12; excludes M13 (annual average).
const MONTHLY_PERIOD = /^M(0[1-9]|1[0-2])$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Extract the latest monthly value from a BLS series response and convert
 * it to the app's unit via the mapping's factor. BLS returns data points
 * newest-first, so the first monthly point with a parseable value wins.
 * Returns null when the series is missing, empty, or has no parseable
 * monthly value.
 */
export function mapBlsSeriesToPrice(
  series: BlsSeriesResponse | undefined | null,
  mapping: BlsMappingEntry
): number | null {
  if (!series || !Array.isArray(series.data)) return null;

  for (const point of series.data) {
    if (!MONTHLY_PERIOD.test(point.period)) continue;
    const value = Number.parseFloat(point.value);
    if (!Number.isFinite(value)) continue;
    return round2(value * mapping.factor);
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scripts/__tests__/blsPriceMapping.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/blsPriceMapping.ts scripts/__tests__/blsPriceMapping.test.ts
git commit -m "feat: add BLS series mapping table and price conversion function"
```

---

### Task 2: Refresh script + npm wiring + real-data verification

**Files:**
- Create: `scripts/refreshBlsPrices.ts`
- Modify: `package.json:5-15` (add `prices:refresh-bls` script)
- Modify (by running the script, not by hand): `src/data/priceDatabase.json`

**Interfaces:**
- Consumes (from Task 1): `BLS_SERIES`, `BlsMappingEntry`, `BlsSeriesResponse`, `mapBlsSeriesToPrice` — all from `./lib/blsPriceMapping`.

- [ ] **Step 1: Implement `scripts/refreshBlsPrices.ts`**

```ts
/**
 * BLS Average Price -> priceDatabase.json refresh script.
 *
 * Pulls the latest national-average grocery prices from the BLS Average
 * Price API (https://api.bls.gov/publicAPI/v2/timeseries/data/) for every
 * key in BLS_SERIES (scripts/lib/blsPriceMapping.ts) and overwrites that
 * key's pricePerUnit in src/data/priceDatabase.json. Every other key is
 * left untouched -- BLS only tracks a fixed list of national series, so
 * most of priceDatabase.json has no mapping and keeps its hand-estimated
 * value.
 *
 * This is a manual, local, build-time tool (like scripts/importMealDb.ts)
 * -- it fails loudly on any error and never writes a partial file.
 *
 * Usage:
 *   npm run prices:refresh-bls
 *   BLS_API_KEY=... npm run prices:refresh-bls   # higher rate limit
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BLS_SERIES, mapBlsSeriesToPrice, BlsSeriesResponse } from './lib/blsPriceMapping';

const BLS_ENDPOINT = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const UNREGISTERED_BATCH_SIZE = 25;
const REGISTERED_BATCH_SIZE = 50;
const PRICE_DB_PATH = 'src/data/priceDatabase.json';

interface BlsApiResponse {
  status: string;
  message?: string[];
  Results?: { series: BlsSeriesResponse[] };
}

interface PriceEntry {
  pricePerUnit: number;
  unit: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchBatch(
  seriesIds: string[],
  apiKey: string | undefined
): Promise<BlsSeriesResponse[]> {
  const now = new Date();
  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: String(now.getFullYear() - 1),
    endyear: String(now.getFullYear()),
  };
  if (apiKey) body.registrationkey = apiKey;

  const res = await fetch(BLS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`BLS API HTTP ${res.status} for series [${seriesIds.join(', ')}]`);
  }
  const data = (await res.json()) as BlsApiResponse;
  if (data.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API request failed: ${data.message?.join('; ') ?? data.status}`);
  }
  return data.Results?.series ?? [];
}

async function fetchAllSeries(
  seriesIds: string[],
  apiKey: string | undefined
): Promise<Map<string, BlsSeriesResponse>> {
  const batchSize = apiKey ? REGISTERED_BATCH_SIZE : UNREGISTERED_BATCH_SIZE;
  const byId = new Map<string, BlsSeriesResponse>();
  for (const batch of chunk(seriesIds, batchSize)) {
    const results = await fetchBatch(batch, apiKey);
    for (const series of results) byId.set(series.seriesID, series);
  }
  return byId;
}

async function main(): Promise<void> {
  const apiKey = process.env.BLS_API_KEY;
  console.log(
    apiKey
      ? 'Using registered BLS API key (higher rate limit).'
      : 'No BLS_API_KEY set -- running unregistered (lower rate limit).'
  );

  const entries = Object.entries(BLS_SERIES);
  const seriesIds = entries.map(([, mapping]) => mapping.seriesId);
  const seriesById = await fetchAllSeries(seriesIds, apiKey);

  const priceDb = JSON.parse(readFileSync(PRICE_DB_PATH, 'utf-8')) as Record<string, PriceEntry>;

  const updates: Array<{ key: string; oldPrice: number; newPrice: number; unit: string }> = [];
  for (const [key, mapping] of entries) {
    const series = seriesById.get(mapping.seriesId);
    if (!series) {
      throw new Error(`No data returned for series "${mapping.seriesId}" (key: "${key}")`);
    }
    const newPrice = mapBlsSeriesToPrice(series, mapping);
    if (newPrice === null) {
      throw new Error(`Could not parse a monthly price for key "${key}" (series "${mapping.seriesId}")`);
    }
    const existing = priceDb[key];
    if (!existing) {
      throw new Error(`priceDatabase.json has no entry for key "${key}" -- mapping table is out of sync`);
    }
    updates.push({ key, oldPrice: existing.pricePerUnit, newPrice, unit: existing.unit });
    priceDb[key] = { ...existing, pricePerUnit: newPrice };
  }

  writeFileSync(PRICE_DB_PATH, JSON.stringify(priceDb, null, 2) + '\n');

  console.log('\nUpdated prices:');
  for (const { key, oldPrice, newPrice, unit } of updates) {
    console.log(`  ${key}: ${oldPrice} -> ${newPrice} (${unit})`);
  }
}

main().catch((err) => {
  console.error('refreshBlsPrices failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to the `"scripts"` object (after `"seed:build"`):

```json
    "prices:refresh-bls": "tsx scripts/refreshBlsPrices.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the script against the real BLS API**

Run: `npm run prices:refresh-bls`
Expected: exits 0, logs "No BLS_API_KEY set -- running unregistered", then prints an "Updated prices:" line for all 13 keys in `BLS_SERIES`, each showing a plausible grocery price (e.g. `ground beef: 6 -> 5.98 (lb)`).

If it throws instead (network error, a series ID returning no data, etc.), fix the mapping table entry or fetch logic before continuing — do not proceed with a failing script.

- [ ] **Step 5: Inspect the diff**

Run: `git diff src/data/priceDatabase.json`
Expected: only the 13 keys listed in the Task 1 mapping table show a changed `pricePerUnit`; every other key and the file's key order are unchanged. Confirm the `eggs` value looks like a plausible per-egg price (roughly $0.20-$0.60) and `milk` looks like a plausible per-gallon price (roughly $3-$5) — a sanity check that the dozen->each and gallon->gallon factors applied correctly.

- [ ] **Step 6: Verify failure handling (no partial write)**

Temporarily edit `scripts/lib/blsPriceMapping.ts`, changing the `rice` entry's `seriesId` from `'APU0000701312'` to an invalid value, e.g. `'APU0000000000'`:

```ts
  rice: { seriesId: 'APU0000000000', blsUnit: 'lb', factor: 1 },
```

Run: `npm run prices:refresh-bls`
Expected: the script throws `No data returned for series "APU0000000000" (key: "rice")` and exits non-zero.

Run: `git diff src/data/priceDatabase.json`
Expected: no changes — the file was not touched by the failing run (the write only happens after every series is successfully resolved).

Revert the temporary edit:

```bash
git checkout -- scripts/lib/blsPriceMapping.ts
```

- [ ] **Step 7 (optional): Verify the registered-key path**

If you have a free BLS API key (register at https://www.bls.gov/developers/), run:

```bash
BLS_API_KEY=your-key-here npm run prices:refresh-bls
```

Expected: logs "Using registered BLS API key" instead of the unregistered message, and completes the same as Step 4. Skip this step if you don't have a key — the unregistered path in Step 4 already exercises the same code path with a smaller batch size.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `blsPriceMapping.test.ts` and the existing `priceEstimator`/`mealCatalogPriceCoverage` tests (unaffected, since only values changed).

- [ ] **Step 9: Commit**

```bash
git add scripts/refreshBlsPrices.ts package.json src/data/priceDatabase.json
git commit -m "feat: add BLS price refresh script, wire npm run prices:refresh-bls"
```

---

## Post-plan follow-ups (not part of this plan)

- USDA ERS spreadsheet ingestion for categories BLS doesn't track (fresh produce especially) — out of scope per the spec.
- Re-running `npm run prices:refresh-bls` periodically is a manual habit for now, not automated.
