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

// Compares two monthly data points by (year, period) and reports whether `a`
// is strictly newer than `b`. Period codes are zero-padded (`M01`..`M12`),
// so lexicographic comparison of equal-length strings is correct.
function isNewer(a: BlsSeriesDataPoint, b: BlsSeriesDataPoint): boolean {
  const yearA = Number.parseInt(a.year, 10);
  const yearB = Number.parseInt(b.year, 10);
  if (yearA !== yearB) return yearA > yearB;
  return a.period > b.period;
}

export interface BlsPricePoint {
  price: number;
  year: string;
  periodName: string;
}

/**
 * Extract the latest monthly value from a BLS series response and convert
 * it to the app's unit via the mapping's factor. Explicitly selects the
 * data point with the greatest (year, period) rather than trusting BLS's
 * array order -- a discontinued/frozen series or an unexpected ordering
 * won't silently produce a stale value. The returned period lets the caller
 * surface which month the price came from. Returns null when the series is
 * missing, empty, or has no parseable monthly value.
 */
export function mapBlsSeriesToPrice(
  series: BlsSeriesResponse | undefined | null,
  mapping: BlsMappingEntry
): BlsPricePoint | null {
  if (!series || !Array.isArray(series.data)) return null;

  let latest: BlsSeriesDataPoint | null = null;
  for (const point of series.data) {
    if (!MONTHLY_PERIOD.test(point.period)) continue;
    if (!Number.isFinite(Number.parseFloat(point.value))) continue;
    if (!latest || isNewer(point, latest)) latest = point;
  }

  if (!latest) return null;
  const value = Number.parseFloat(latest.value);
  return { price: round2(value * mapping.factor), year: latest.year, periodName: latest.periodName };
}
