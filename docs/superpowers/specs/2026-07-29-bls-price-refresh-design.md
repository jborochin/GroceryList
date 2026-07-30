# BLS Average Price Refresh — Design Spec

**Date:** 2026-07-29
**Status:** Approved

## Context

`src/data/priceDatabase.json` is a ~100-entry hand-curated `name → { pricePerUnit, unit }` table, consumed by `findPrice()` (`src/utils/priceLookup.ts`) and `estimatePrices()` (`src/utils/priceEstimator.ts`) to price grocery items. Values are one-time guesses with no connection to real market data.

The repo has two existing patterns for pulling in external data:
- **Runtime edge functions** (`supabase/functions/compute-nutrition`) — live, per-request, fails open, secret key stays server-side.
- **Build-time scripts** (`scripts/buildSeedMeals.ts`, `scripts/importMealDb.ts`) — run locally by hand, fetch/transform external data, regenerate a checked-in file that gets committed.

"USDA/BLS" pricing data fits the second pattern, not the first: it's periodic national-average data, not a per-item live lookup. Specifically:
- **BLS Average Price Data** (`api.bls.gov`) is a real JSON REST API, free, covering a *fixed* list of ~40-70 national grocery series (e.g. "ground beef, 100% beef, per lb", "eggs, grade A, large, per doz").
- **USDA ERS** data (Fruit & Vegetable Prices, Food Price Outlook) is broader but distributed as CSV/Excel downloads, not a queryable API — deferred, see Out of Scope.

## Goal

A manual refresh script that pulls current national-average prices from the BLS API for whichever `priceDatabase.json` entries BLS tracks, and overwrites those entries in place. Run occasionally by hand (like `npm run seed:build`), review the printed diff, commit if it looks right. Entries BLS doesn't cover are untouched.

---

## Architecture

### Script: `scripts/refreshBlsPrices.ts`

Run via `npm run prices:refresh-bls` (`tsx scripts/refreshBlsPrices.ts`, matching the `import:mealdb`/`seed:build` convention in `package.json`).

Flow:
1. Load the hardcoded series mapping table (see below).
2. Split the series IDs into batches — ≤25 per request if `BLS_API_KEY` is unset, ≤50 if it's set — and POST each batch to `https://api.bls.gov/publicAPI/v2/timeseries/data/`, requesting the latest data point(s).
3. For each series in the response, pull the most recent monthly value and run it through the pure conversion function (below) to get `{ pricePerUnit, unit }` in the app's existing unit for that key.
4. Read `src/data/priceDatabase.json`, overwrite only the keys present in the mapping table with their new values, leave every other key byte-for-byte as-is, write the file back.
5. Print an old → new summary line per updated key (`eggs: 0.30 → 0.32 (each)`) so the diff is reviewable before committing — this script never commits on its own.

### Series mapping table: `scripts/lib/blsPriceMapping.ts`

```ts
interface BlsMappingEntry {
  seriesId: string;      // BLS series ID, e.g. "APU0000708111"
  blsUnit: string;       // documentation only — the unit BLS reports in
  factor: number;        // multiply BLS's per-blsUnit price by this to get
                          // the price per the app's existing unit for this key
}

const BLS_SERIES: Record<string, BlsMappingEntry> = {
  "ground beef": { seriesId: "APU0000703112", blsUnit: "lb", factor: 1 },
  "eggs":        { seriesId: "APU0000708111", blsUnit: "dozen", factor: 1 / 12 },
  "milk":        { seriesId: "APU0000709112", blsUnit: "half-gallon", factor: 2 },
  // ...~15-25 entries total at first pass
};
```

- Keyed by the exact `priceDatabase.json` key it updates. `factor` bridges BLS's reporting unit to whatever unit that key already uses (dozen→each, half-gallon→gallon, lb→lb, etc.) — the app's canonical unit for a key never changes, only its price.
- Only entries BLS actually tracks get a row. Everything else in `priceDatabase.json` (the majority of the ~100 entries — most produce, spices, pantry staples) has no mapping and is left as the existing hand-estimated value. That's expected, not a gap to close in this pass.
- Real BLS series IDs and units will be looked up and filled in during implementation (the three above are illustrative of the shape, not verified IDs).

### Pure conversion function

```ts
function mapBlsSeriesToPrice(
  series: BlsSeriesResponse,
  mapping: BlsMappingEntry
): { pricePerUnit: number; unit: string } | null
```

Lives in `scripts/lib/blsPriceMapping.ts` alongside the table, takes one series' raw API response plus its mapping entry, returns the converted price or `null` for a malformed/empty response. Kept pure and separate from the fetch/file-write shell in `refreshBlsPrices.ts` so it's unit-testable without hitting the network.

### API key handling

- `BLS_API_KEY` is an optional env var (`BLS_API_KEY=... npm run prices:refresh-bls`), not committed anywhere.
- Unset: script runs against BLS's unregistered tier (25 series/request, lower daily rate limit) and batches accordingly — logs a note that it's running unregistered.
- Set: uses it for higher limits (50 series/request).
- This is a local, manual, build-time script — the key never ships in the app bundle, so there's no server-side-secret concern like `compute-nutrition` has.

---

## Error Handling

This only ever runs manually, locally, by a developer watching the output — not a runtime path in the app. It fails loudly:
- Any network error, non-200 response, or a series missing/malformed in the response throws immediately with the offending series ID and mapping key.
- No partial writes — `priceDatabase.json` is only written once all series have been successfully parsed and converted.
- No "fail open" behavior (unlike `compute-nutrition`, which must degrade gracefully at runtime) — if this script fails, the developer sees why and re-runs it.

---

## Testing

- `scripts/__tests__/blsPriceMapping.test.ts` (already matched by the existing jest `testMatch: ["**/__tests__/**/*.test.ts"]` glob) tests `mapBlsSeriesToPrice()`:
  - Direct unit match (BLS `lb` → app `lb`, factor 1)
  - Factor conversion (dozen → each, half-gallon → gallon)
  - Malformed/empty series response → `null`
- No test for the network call itself or the file-overwrite step, matching how `importMealDb.ts` and `buildSeedMeals.ts` are handled today (untested build-time tooling, not `src/utils/`).
- Existing `priceEstimator.test.ts` and `mealCatalogPriceCoverage.test.ts` need no changes — the script only changes numeric values for existing keys, never keys or units, so lookup behavior is unaffected.

---

## Out of Scope

- USDA ERS spreadsheet data — deferred; the mapping table's shape (key → source-specific identifier → conversion factor) leaves room to add an ERS-backed table later for categories BLS doesn't track (fresh produce especially), but parsing CSV/Excel downloads is a separate piece of work.
- Automating the refresh (scheduled GitHub Action, auto-PR) — this is a manual, occasional, hand-run script for now.
- A layered/overlay data file distinguishing "government-sourced" from "hand-estimated" prices — explicitly decided against; the script overwrites `priceDatabase.json` in place and a re-run simply replaces whatever was there.
- Any change to `priceLookup.ts`, `priceEstimator.ts`, `purchaseProfile.ts`, or the lookup order — this spec only changes how `priceDatabase.json`'s values get produced, not how they're consumed.
- Expanding `BLS_API_KEY` registration guidance beyond a one-line env var note — no in-app UI, no onboarding flow.

---

## Verification

1. Run `npm run prices:refresh-bls` without `BLS_API_KEY` set — confirm it completes using the unregistered tier, prints an old→new summary for each mapped key, and `git diff src/data/priceDatabase.json` shows only those keys changed.
2. Set `BLS_API_KEY` and re-run — confirm it still succeeds (higher batch size, same output shape).
3. Temporarily break a series ID in the mapping table — confirm the script throws with a clear message identifying the bad key/series, and `priceDatabase.json` is left unmodified.
4. Run `npm test` — new `blsPriceMapping.test.ts` cases pass, all existing tests (`priceEstimator`, `mealCatalogPriceCoverage`, etc.) still pass unchanged.
5. Run `npm run typecheck` — no regressions.
