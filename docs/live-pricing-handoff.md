# Live ingredient pricing — handoff

**Branch:** `feat/ingredient-pricing-api` (6 commits ahead of `main`, pushed)
**Status:** built and validated end to end, **not yet live to any user**
**Last updated:** 2026-08-10

---

## What this feature is

Grocery totals used to come entirely from `src/data/priceDatabase.json` — 172 hand-written
prices, 13 of which a manual BLS script refreshed. Changing any of them needed an app release.

This adds a weekly server-side refresh from the Kroger Products API (national averages, one job
serving every user), published to a public-read `public.prices` table that the app consults as an
**overlay** on the bundled JSON:

```
user override  →  live overlay (exact match only)  →  bundled exact  →  substring  →  fuzzy
```

The bundled JSON remains the offline floor and the test-enforced source of truth. An empty, stale,
or missing overlay means exactly the pre-feature behavior.

Full architecture notes live in `CLAUDE.md` under **"Live prices overlay the bundled ones"**, and
operational setup in `supabase/README.md` under **"Live price refresh"**. Read both before changing
anything here.

---

## Current state

| Thing | State |
|---|---|
| Schema (`public.prices`, `public.price_sources`) | **Applied** to project `hpysyrhpnfdisowfvuuh` ("Grocery List") |
| `price_sources` rows | **172 seeded**, 0 marked `reviewed` |
| `public.prices` rows | **0** — nothing published yet |
| GitHub Actions secrets | **Not set** — the weekly workflow cannot run yet |
| Client overlay code | Merged on the branch, **not in any shipped build** |
| Tests | 336 passing, `npm run typecheck` clean |

Because `public.prices` is empty *and* no build ships `priceCatalogSync`, users currently see
identical behavior to before this feature. Everything below is safe to do without user impact until
the final step.

### Last dry run (2026-08-10, four chunks of 44)

```
172 processed → 163 published, 9 rejected, 0 API errors
mean live/bundled ratio: 1.32x
  <0.6x:  5      0.6-1.6x: 119      >1.6x: 39
11 ingredients have a candidate pool of 1-2
```

---

## BLOCKING: the 1.32x decision (needs a human, not an agent)

Publishing as-is would raise every user's grocery total by roughly a third, in one step, on the
first real run. This is **not a bug** — the mid-priced real SKU is a better estimate than a hand
guess — but it is a visible product change and it has not been decided.

Do not run the job without `--dry-run` until this is settled. Options:

1. **Accept it.** Totals become more accurate and go up.
2. **Bias selection lower.** `pickMedianBy` in `scripts/lib/krogerMatch.ts` currently takes the
   lower-middle candidate by price; take a lower quantile instead.
3. **Tighten the sanity band** from `UNREVIEWED_BAND` 0.25–4x toward ~2x, which drops more of the
   high tail into rejection (and therefore onto the bundled price).
4. **Re-baseline.** Write this run's prices into `priceDatabase.json` so bundled and overlay start
   from the same place, making the visible jump happen once at release rather than at flip.

---

## Remaining tasks, in order

### 1. `tomato paste` — the last unbridgeable ingredient
Add to `src/data/purchaseProfiles.json`:
```json
"tomato paste": { "sellUnit": "can", "packSize": 1, "grams": { "can": 170, "tbsp": 16 } }
```
Standard can is 6 oz. Follow the rule in §"Invariants" below: `sellUnit` **must** equal the key's
`priceDatabase.json` unit (`can`).

### 2. Traps for the prepared/snack pattern
Three rejections were the same failure — a snack or cured product containing the ingredient word:

- `banana` → Simple Truth Berries and Banana **Trail Mix** (13.8x)
- `fennel` → Brooklyn Cured Finocchiona Fennel **Salami** (12.7x)
- `chickpea` → Simple Truth Baked Chickpea **Crisps** (11.2x)

Add `trail`, `salami`, `crisp`, `chip`, `cracker` to `TRAP_TOKENS` in `scripts/lib/krogerMatch.ts`
and extend `scripts/__tests__/krogerMatch.test.ts` with the three live descriptions above.

The sanity band already catches these, so this is about not burning candidate slots, not safety.

**Do NOT add `frozen`** — several catalog ingredients are legitimately frozen
(`frozen mixed berry`, `edamame`, `stir-fry vegetable`) and the veto would break them.

### 3. Review the high-ratio tail and the thin pools
39 publishes sit above 1.6x, and 11 drew from a candidate pool of 1–2 (so "mid-range" had nothing
to choose from). Known bad match to fix: **`zucchini` → "Pictsweet Farms Red Potatoes Carrots
Onions" at 2.5x**, which passed scoring and should not have.

Full reviewable table with filters:
<https://claude.ai/code/artifact/9d585ef8-5061-4114-9277-100fab46c07e>

Known *unfixable-by-matching* cases — recipe unit vs retail packaging genuinely disagree, and the
sanity band correctly rejects them. Leave them on bundled prices unless someone wants to rethink
the units:
- `cilantro` / `parsley` — Kroger sells 0.75 oz clamshells, not bunches
- `lettuce` — bagged leaf vs a head
- `green onion` — paste vs fresh
- `salt` — sea salt SKUs vs the table-salt baseline

### 4. Pin the matches you trust
```sql
update public.price_sources set reviewed = true
where last_status = 'published' and confidence >= 0.9;
```
Reviewed rows pin their `kroger_product_id` and are never re-searched, so review work is permanent
and re-running the seed never undoes it.

### 5. Set the GitHub Actions secrets
Required: `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Optional: `KROGER_LOCATION_IDS` (overrides the 12 committed reference stores).

### 6. First real run — only after step 0 is decided
Trigger `.github/workflows/refresh-prices.yml` manually (it has a dry-run checkbox) before relying
on the weekly cron. Then verify:
```sql
select normalized_name, price_per_unit, unit, confidence, as_of
from public.prices order by confidence nulls first;
```

### 7. Ship a client build
Until a release contains `src/lib/priceCatalogSync.ts`, existing installs ignore `public.prices`
entirely no matter what is in it.

---

## Invariants — breaking these causes silent, hard-to-trace bugs

**1. The overlay may restate a price but never its unit.**
`getProfile()` derives its sell unit from the price entry (`src/utils/purchaseProfile.ts:38`), and
`roundToPurchasable()` branches on that unit's *family*. An overlay row that changed `lb` to `each`
would silently change purchase rounding. Enforced twice — the refresh script rejects conversions it
cannot land in `baseline_unit`, and `ingestRows()` in `src/lib/priceCatalogSync.ts` drops mismatched
rows client-side. Keep both.

**2. Any new `purchaseProfiles.json` entry must set `sellUnit` to that key's `priceDatabase.json`
unit** — unless you *intend* to change how the item is purchased. That is what the derived default
already produced, so matching it keeps rounding provably unchanged. (Pre-existing intentional
divergences like broccoli-by-head are the exception, not the pattern.) Verify with:
```bash
node -e "const p=require('./src/data/purchaseProfiles.json'),d=require('./src/data/priceDatabase.json');
for(const [k,v] of Object.entries(p)){if(k.startsWith('_'))continue;const e=d[k];
if(e&&e.unit!==v.sellUnit)console.log(k,v.sellUnit,'!=',e.unit)}"
```

**3. The overlay is exact-normalized-match only.** Substring and fuzzy resolution stay on the
bundled DB so behavior for unknown names is unchanged. Do not widen this.

**4. `usePriceCatalogStore` is deliberately NOT persisted** and must stay out of the `stores` array
in `src/store/hydration.ts` — adding it there would block hydration forever waiting for a rehydrate
that never fires.

**5. Never hardcode a dollar price in a test** for an ingredient that is BLS-mapped
(`scripts/lib/blsPriceMapping.ts`) or live-priced. Tests never see the overlay unless they seed it,
so bundled assertions are safe — use a non-BLS fixture like `tofu`, and seed live prices explicitly
via `loadPriceCache()`.

---

## Gotchas already discovered (don't re-learn these)

- **`tsx` does not read `.env`.** `scripts/lib/loadEnv.ts` handles it; real env vars always win so
  CI is unaffected. Node's `--env-file` was rejected because it throws when the file is absent.
- **The service-role key is read as `SUPABASE_SERVICE_ROLE_KEY` *or* `SUPABASE_SERVICE_ROLE`**
  (the dashboard labels it `service_role`). `SUPABASE_URL` falls back to `EXPO_PUBLIC_SUPABASE_URL`.
  The key itself has no `EXPO_PUBLIC_` fallback **on purpose** — that would bundle it into the app.
- **Kroger sheds load well below the quota.** A full run is ~2,000 calls of 10,000/day, but at
  ~2.5 req/sec it returned HTTP 503 for 26 of 172 ingredients. Fixed with 120 ms process-wide
  pacing and 5 retries on 1/2/4/8 s backoff. Do not lower these to speed the job up.
- **A full run takes 12–15 minutes** and was killed once with nothing to show. Progress now streams
  per ingredient, and `--offset N --limit M` tiles the work over a stable sort:
  ```bash
  npm run prices:refresh-kroger -- --dry-run --offset 0 --limit 44
  ```
- **Composite sizes (`8 ct / 30.4 ounce`) are refused deliberately.** Retail uses that shape for
  both "N items totalling M" and "N items of M each"; guessing wrong is a 6–8x error. Do not try to
  parse them.
- **Not every banner stocks every SKU.** A Kroger-brand item returns no price at Ralphs or Harris
  Teeter, so a given ingredient's median is typically over 7–11 of the 12 stores. `median()` skips
  the misses — this is expected, not a failure.

---

## Commands

```bash
npm run prices:seed-sources            # regenerate seed_price_sources.sql after adding a price key
npm run prices:find-locations 45202    # discover store ids (filters out fuel/logistics sites)
npm run prices:refresh-kroger -- --dry-run [--offset N --limit M]
npm run typecheck && npm test          # 336 tests; all must stay green
```

Adding a new ingredient needs **no mapping work**: add the `priceDatabase.json` row (already
mandatory — `mealCatalogPriceCoverage.test.ts` enforces it), run `prices:seed-sources`, apply the
SQL. The next weekly run auto-matches it, and until then it prices off the bundled estimate.

---

## Do not touch

`app.json`, `eas.json`, `package-lock.json`, `src/lib/supabase.ts`, `.mcp.json`,
`skills-lock.json`, `.claude/settings.local.json`, and the `expo-updates` line in `package.json`
are uncommitted **pre-existing EAS work** unrelated to this feature. They have been deliberately
left out of every commit on this branch. Do not sweep them in.
