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

## Current state (updated 2026-08-10, post re-baseline)

| Thing | State |
|---|---|
| Schema (`public.prices`, `public.price_sources`) | **Applied** to project `hpysyrhpnfdisowfvuuh` ("Grocery List") |
| `price_sources` rows | **172 seeded**, 0 marked `reviewed` |
| `public.prices` rows | **0** — nothing published for real yet (still only dry runs) |
| GitHub Actions secrets | **Not set** — the weekly workflow cannot run yet |
| Client overlay code | Merged on the branch, **not in any shipped build** |
| `priceDatabase.json` | **Re-baselined**: 136 of 172 keys rewritten to this run's live Kroger prices |
| Tests | 344 passing, `npm run typecheck` clean |

Because `public.prices` is still empty *and* no build ships `priceCatalogSync`, users currently see
identical behavior to before this feature.

### The 1.32x decision — RESOLVED: re-baselined

Publishing the live overlay as-is would have raised every user's grocery total by ~32% in one step
at first flip. Decision made: **re-baseline** — write this run's prices into `priceDatabase.json`
now, so bundled and (a future) overlay start from the same place and the visible jump happens once
at release rather than at flip. The other three options (accept as-is / bias lower / tighten the
band) were not taken.

**What was re-baselined:** of 172 ingredients, 136 keys were rewritten to this run's live Kroger
price. Excluded, deliberately:
- The 13 `BLS_SERIES` keys (`scripts/lib/blsPriceMapping.ts`) — those are BLS-sourced already, not
  hand-guesses, and `npm run prices:refresh-bls` would silently overwrite a manual edit anyway.
- **15 thin-candidate-pool matches** (pool ≤ 2 — see `bagel`, `bean sprout`, `coleslaw mix`,
  `cornstarch`, `eggplant`, `frozen mixed berry`, `green curry paste`, `hamburger bun`,
  `lasagna noodle`, `lemon`, `lime`, `pad thai sauce`, `pita`, `red pepper flake`, `tortilla`) — a
  pool that thin means "mid-range" had nothing to choose from. Most looked fine on inspection, but
  they're left on the old bundled price pending the step-3 review below rather than trusted blind.
- `zucchini` — see matching fixes below; it now scores 0 and never entered the pool at all.

**Sanity check:** the excluded-key mean ratio for the 136 applied was ~1.31x (matches the original
1.32x closely, as expected — only one item, zucchini, was newly excluded from what the original
dry run scored). Applying it makes bundled ≈ live, so the eventual overlay flip should be a
non-event for these 136 ingredients.

**Re-verify before ever repeating this:** don't re-run this re-baseline mechanically off a stale
dry-run log — the matcher has changed twice since the original 2026-08-10 dry run (see below), and
another live dry run may score differently now.

---

## Remaining tasks, in order

### 1. ~~`tomato paste`~~ — DONE
Added to `src/data/purchaseProfiles.json`:
```json
"tomato paste": { "sellUnit": "can", "packSize": 1, "grams": { "can": 170, "tbsp": 16 } }
```
Standard can is 6 oz. `sellUnit` matches the key's `priceDatabase.json` unit (`can`), per the
invariant below. Verified with the invariant-check one-liner in §Invariants.

### 2. ~~Traps for the prepared/snack pattern~~ — DONE
Added `trail`, `salami`, `crisp`, `chip`, `cracker` to `TRAP_TOKENS` in
`scripts/lib/krogerMatch.ts`, catching the three originally-reported live rejections
(`banana`→Trail Mix, `fennel`→Salami, `chickpea`→Crisps) plus regression coverage for the general
pattern (`potato`→Chips, `cheddar cheese`→Crackers) in `scripts/__tests__/krogerMatch.test.ts`.

`frozen` was deliberately NOT added, per the original warning (`frozen mixed berry`, `edamame`,
`stir-fry vegetable` are legitimately frozen).

### 3. Review the high-ratio tail and the thin pools — PARTIALLY DONE
Ran the full live dry run (2026-08-10, all 172, no `--offset`/`--limit`). Results:

```
172 processed → 165 published, 7 rejected
mean live/bundled ratio: 1.31x (of the 136 ultimately re-baselined — see below)
```

**Two real match-quality bugs found and fixed** by re-scoring every published row's actual matched
description against `scoreMatch()` after the trap-word changes above (see
`scripts/lib/krogerMatch.ts` for the code, `scripts/__tests__/krogerMatch.test.ts` for regressions):

- **`zucchini` → "Pictsweet Farms® Red Potatoes Carrots Onions Zucchini Frozen Vegetables" (2.5x).**
  The originally-suspected fix (add `blend`/`medley` to `TRAP_TOKENS`) does NOT catch this — the
  real title has neither word. Fixed with a *new* check: for single-word search terms, if the
  description names ≥3 OTHER known single-word `priceDatabase.json` ingredients (here: potato,
  carrot, onion), reject it as an unlabeled multi-item bag. Threshold is 3, not 2 — at 2 it also
  false-positived on legitimate single-product SKUs that name 1-2 of their own ingredients in the
  title (`granola`→"Oats and Honey Granola", `pita`→"Flax Oat Bran...Pita Bread",
  `quinoa`→"Quinoa & Brown Rice with Garlic"). Gated to single-word terms only — `stir-fry
  vegetable` (3 tokens) IS itself a blend product by design and must not be vetoed by its own
  `blend`/`medley`/co-occurrence words.
- **`cornstarch` → "Comforts™ Fresh Scent Pure Cornstarch Baby Powder"** — matched a baby-powder
  product, not the cooking ingredient. A bare `baby` trap token would also reject "Baby Carrots" (an
  ordinary, extremely common real carrot SKU), so this needed a phrase-pair veto (`baby` AND
  `powder` together) — see `PHRASE_TRAPS` in `scripts/lib/krogerMatch.ts`. (Also pool=1, so it would
  have been excluded from the re-baseline regardless — see below.)

**Thin pools (pool ≤ 2, 15 of 172):** rather than hand-adjudicate each one, all were excluded from
the re-baseline and left on the bundled price. On inspection most looked fine (`eggplant`, `tortilla`,
`lemon`/`lime`) but a few are genuinely questionable (`hamburger bun`→a keto specialty bun,
`frozen mixed berry`→a mango-berry blend) — worth a human look before ever trusting them. Full list:
`bagel`, `bean sprout`, `coleslaw mix`, `cornstarch`, `eggplant`, `frozen mixed berry`,
`green curry paste`, `hamburger bun`, `lasagna noodle`, `lemon`, `lime`, `pad thai sauce`, `pita`,
`red pepper flake`, `tortilla`.

**Not yet done:** the doc's original "unfixable-by-matching" list (`cilantro`/`parsley`/`lettuce`/
`green onion`/`salt` — retail packaging genuinely disagrees with recipe units) is unchanged; the
sanity band still correctly rejects these. The full 172-row reviewable table link in the original
handoff may be stale — re-generate from a fresh dry run if you need it.

### 4. Pin the matches you trust — NOT DONE (blocked)
Needs `price_sources.last_status`/`confidence` populated, which only happens on a REAL (non-dry)
run — a dry run writes nothing. Blocked on step 6.
```sql
update public.price_sources set reviewed = true
where last_status = 'published' and confidence >= 0.9;
```
Reviewed rows pin their `kroger_product_id` and are never re-searched, so review work is permanent
and re-running the seed never undoes it.

### 5. Set the GitHub Actions secrets — NOT DONE
Required: `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Optional: `KROGER_LOCATION_IDS` (overrides the 12 committed reference stores). These already exist
in the local `.env` (used for the dry run above) — they still need to be added as GitHub Actions
secrets for the weekly CI workflow to run unattended. This needs a human with repo admin access; an
agent should not push credential values into CI without being explicitly asked to.

### 6. First real run — the 1.32x decision is now resolved (re-baselined), but NOT triggered yet
The `--dry-run` flag was never dropped this session — no write to `public.prices` or
`public.price_sources` has happened. Writing real rows to the shared Supabase project is a
meaningful shared-infrastructure change and should be an explicit, separate go-ahead rather than
something folded into a re-baseline decision. Once ready:
```
npm run prices:refresh-kroger              # for real, no --dry-run
```
or trigger `.github/workflows/refresh-prices.yml` manually (after step 5). Then verify:
```sql
select normalized_name, price_per_unit, unit, confidence, as_of
from public.prices order by confidence nulls first;
```

### 7. Ship a client build — NOT DONE
Until a release contains `src/lib/priceCatalogSync.ts`, existing installs ignore `public.prices`
entirely no matter what is in it. A TestFlight/App Store build is its own explicit decision — see
the `publish-testflight` skill — and shouldn't be bundled into finishing this feature without a
separate go-ahead.

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
npm run typecheck && npm test          # 344 tests; all must stay green
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
