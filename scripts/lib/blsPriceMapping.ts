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
