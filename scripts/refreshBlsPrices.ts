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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// priceDatabase.json is hand-formatted with each entry on a single line
// (e.g. `"eggs": { "pricePerUnit": 0.30, "unit": "each" },`), not the
// multi-line layout JSON.stringify(x, null, 2) would produce. Re-serializing
// the whole object would reformat every untouched key too, which breaks the
// "only the 13 mapped keys may change" contract. Instead, surgically replace
// just the pricePerUnit numeral on that key's line, leaving every byte of
// the surrounding file (including unrelated keys and key order) untouched.
function replacePricePerUnit(text: string, key: string, newPrice: number): string {
  const pattern = new RegExp(`("${escapeRegExp(key)}"\\s*:\\s*\\{\\s*"pricePerUnit"\\s*:\\s*)[0-9.]+`);
  if (!pattern.test(text)) {
    throw new Error(`Could not locate a "pricePerUnit" field for key "${key}" in ${PRICE_DB_PATH}`);
  }
  return text.replace(pattern, `$1${newPrice.toFixed(2)}`);
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

  const rawText = readFileSync(PRICE_DB_PATH, 'utf-8');
  const priceDb = JSON.parse(rawText) as Record<string, PriceEntry>;

  const updates: Array<{
    key: string;
    oldPrice: number;
    newPrice: number;
    unit: string;
    year: string;
    periodName: string;
  }> = [];
  for (const [key, mapping] of entries) {
    const series = seriesById.get(mapping.seriesId);
    if (!series) {
      throw new Error(`No data returned for series "${mapping.seriesId}" (key: "${key}")`);
    }
    const result = mapBlsSeriesToPrice(series, mapping);
    if (result === null) {
      throw new Error(`Could not parse a monthly price for key "${key}" (series "${mapping.seriesId}")`);
    }
    const existing = priceDb[key];
    if (!existing) {
      throw new Error(`priceDatabase.json has no entry for key "${key}" -- mapping table is out of sync`);
    }
    updates.push({
      key,
      oldPrice: existing.pricePerUnit,
      newPrice: result.price,
      unit: existing.unit,
      year: result.year,
      periodName: result.periodName,
    });
  }

  // Only mutate the file after every series has resolved successfully above
  // -- a surgical per-key text replacement that leaves every other byte
  // (including untouched keys and key order) identical to the source file.
  let newText = rawText;
  for (const { key, newPrice } of updates) {
    newText = replacePricePerUnit(newText, key, newPrice);
  }
  // Sanity check: the rewritten text must still be valid JSON with every
  // updated key reflecting its new price before we touch disk.
  const rewritten = JSON.parse(newText) as Record<string, PriceEntry>;
  for (const { key, newPrice } of updates) {
    if (rewritten[key]?.pricePerUnit !== newPrice) {
      throw new Error(`Internal error: rewritten file does not reflect new price for key "${key}"`);
    }
  }

  writeFileSync(PRICE_DB_PATH, newText);

  console.log('\nUpdated prices:');
  for (const { key, oldPrice, newPrice, unit, year, periodName } of updates) {
    console.log(`  ${key}: ${oldPrice} -> ${newPrice} (${unit}) [${periodName.slice(0, 3)} ${year}]`);
  }
}

main().catch((err) => {
  console.error('refreshBlsPrices failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
