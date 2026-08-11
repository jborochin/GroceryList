# Supabase setup

This folder holds the SQL schema for the MealPrep Grocery backend.

## One-time setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. In the project dashboard, open **SQL Editor** → New query → paste the contents of [`schema.sql`](./schema.sql) → Run. The script is idempotent and can be re-run after edits.
3. **Auth providers** — Authentication → Providers:
   - Enable **Email** (default).
   - Enable **Google**: paste a Web OAuth Client ID + Secret from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). For the redirect URL, use the value Supabase shows under the Google provider settings.
4. **Project credentials** — Settings → API:
   - Copy the **Project URL** into `EXPO_PUBLIC_SUPABASE_URL`.
   - Copy the **anon public key** into `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   - Set both either as env vars or via the `extra` block in `app.json`. See `.env.example` at the project root.

## Schema overview

Six tables, all owned by `auth.uid()` and protected by RLS:

| Table | Purpose | Local store |
| --- | --- | --- |
| `profiles` | Display name (1:1 with `auth.users`) | — |
| `recipes` | Recipes with JSONB ingredients/nutrition | `useRecipeStore` |
| `meal_plan_entries` | Recipe → desired servings | `useMealPlanStore` |
| `pantry_items` | What's in the user's pantry | `usePantryStore` |
| `price_overrides` | User-specific price overrides keyed by `normalizeName()` | `usePriceOverrideStore` |
| `user_settings` | Calorie target, macro %, macro grams, visual prefs | `useSettingsStore` |

A trigger (`on_auth_user_created`) inserts default `profiles` and `user_settings` rows whenever a new auth user is created.

Soft-deletes (`deleted_at`) propagate row removals to other devices on next pull.

### Shared tables (no `user_id`, not per-user synced)

These mirror bundled JSON so content can change without an app release. All three have RLS enabled and **no client write policy** — only the service role can write them.

| Table | Purpose | Bundled floor | Client reader |
| --- | --- | --- | --- |
| `meals` | Curated meal catalog driving auto meal-plans | `src/data/mealCatalog.json` | `src/lib/mealCatalogSync.ts` |
| `prices` | Live ingredient prices (national averages) | `src/data/priceDatabase.json` | `src/lib/priceCatalogSync.ts` |
| `app_config` | Runtime tuning for the pricing pipeline | — | `resolve-prices` (public-read) |
| `price_sources` | Ingredient → retail SKU mapping and review state | — | none (internal) |
| `ingredient_demand` | How often each ingredient is requested | — | none (internal) |

`price_sources` and `ingredient_demand` go further: RLS is enabled with **zero policies**, so no anon or authenticated client can read them at all.

### `app_config` — the tuning surface

Everything about pricing cost and freshness is a row here, so it changes with one statement instead of a redeploy or an app release:

| Key | Default | What it controls |
| --- | --- | --- |
| `price_ttl_days` | `14` | How stale a price may be before an on-demand request re-resolves it |
| `ondemand_enabled` | `true` | Kill switch for on-demand resolution |
| `ondemand_batch_max` | `5` | Names one `resolve-prices` call will accept |
| `ondemand_store_count` | `3` | Reference stores an on-demand resolve medians across |
| `ondemand_lease_seconds` | `120` | How long one invocation owns an ingredient before another may retry |
| `topup_run_call_budget` | `6000` | Hard ceiling on Kroger calls per weekly run |
| `demand_promote_threshold` | `5` | Requests an unpriced ingredient needs before it is worth enrolling |

```sql
update public.app_config set value = '7'::jsonb where key = 'price_ttl_days';
update public.app_config set value = 'false'::jsonb where key = 'ondemand_enabled';  -- stop all Kroger calls
```

Values are read as jsonb and coerced, and `ondemand_enabled` **fails safe** — a string `'"false"'` disables just as a boolean `false` does. Separately, the client ignores any price older than `MAX_PRICE_AGE_DAYS = 60` (`src/lib/priceCatalogSync.ts`), so a dead pipeline decays back to bundled prices rather than freezing.

## Live price refresh

`public.prices` is an overlay `findPrice()` consults ahead of the bundled prices. `truncate public.prices` reverts every device on its next refresh, and rows older than 60 days are ignored client-side, so a dead refresh job decays back to bundled prices instead of freezing.

Two things write it:

- **`resolve-prices`** (edge function, on demand) — the grocery list sends its visible ingredient names; anything stale past `price_ttl_days` is resolved against 1–3 stores and published immediately. This is what keeps a price current between weekly runs.
- **`--top-up`** (weekly CI) — keeps the accurate 12-store median, but only for rows already stale, ordered by `ingredient_demand`, capped by `topup_run_call_budget`.

The split exists because of quota arithmetic: at 520 ingredients a full 12-store sweep is ~6,200 calls against 10,000/day, and the catalog is still growing. Spending the weekly budget on what people actually buy — and letting on-demand cover the rest cheaply — is what makes it fit.

**One-time setup:**

1. Register an app at [developer.kroger.com](https://developer.kroger.com) to get a client id/secret (Products API: 10,000 calls/day).
2. Put the credentials in the repo-root `.env` (gitignored). The price scripts load it via `scripts/lib/loadEnv.ts` — plain `tsx` does not read `.env` the way Expo/Metro does. Real environment variables always win, so CI is unaffected:

   ```
   KROGER_CLIENT_ID=...
   KROGER_CLIENT_SECRET=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

   `SUPABASE_URL` falls back to the `EXPO_PUBLIC_SUPABASE_URL` already in `.env`. The service-role key gets no such fallback on purpose — it must never live under an `EXPO_PUBLIC_` name, which would bundle it into the app.

3. Reference stores need no setup — `KROGER_REFERENCE_LOCATIONS` in `scripts/lib/krogerClient.ts` already lists 12, one per Kroger division (Kroger, Ralphs, King Soopers, Fry's, Harris Teeter, Fred Meyer, Smith's, QFC). They're committed rather than configured because *which* stores compose the median is a substantive choice worth reviewing in a diff. `KROGER_LOCATION_IDS` overrides them.

   To find replacements or add more:

   ```bash
   npm run prices:find-locations 45202 30303 98101
   ```

   Logistics pseudo-locations (forecast sheds, transport spokes, fuel stations) are filtered out — they carry no shelf prices.

   Not every store stocks every SKU: banner-specific private labels (a Kroger-brand item at Ralphs) return no price, so a given ingredient's median is typically taken over 7–11 of the 12. `median()` skips the misses, which is why the store list can be widened freely.

4. Seed the enrollment table: run `npm run prices:seed-sources`, then apply `seed_price_sources.sql` in the SQL editor.
5. Add repository secrets for `.github/workflows/refresh-prices.yml`: `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`KROGER_LOCATION_IDS` is optional).

The workflow runs weekly and on manual dispatch (with a dry-run option), passing `--top-up`. Preview the work order without spending any quota:

```bash
npm run prices:refresh-kroger -- --top-up --dry-run   # prints the selected rows + projected calls
npm run prices:refresh-kroger -- --dry-run            # full sweep, for a manual rebuild
```

`--top-up --dry-run` also prints unpriced ingredients people have asked for more than `demand_promote_threshold` times. Those are the next `scripts/data/proposedIngredients.json` batch — the catalog grows from evidence rather than guesswork.

A full run is ~2,000 calls and takes 12–15 minutes. Progress streams one line per ingredient, so a run that dies partway still leaves its results in the log. `--offset N --limit M` slices the work over a stable sort, letting a long run tile into chunks that fit a terminal session or a CI step:

```bash
npm run prices:refresh-kroger -- --dry-run --offset 0 --limit 44
```

The run summary lists newly enrolled matches to review and everything rejected. Rejections are safe — those ingredients keep their previous or bundled price. To pin a match you've vetted, set `reviewed = true` on its `price_sources` row; reviewed rows are never re-searched.

**Which SKU gets picked:** the mid-priced one among qualifying candidates, not the cheapest. Retail search spans store brand to premium; taking the floor biases grocery totals ~30% low against the bundled baseline. The summary's `Pool` column is how many priceable candidates the median was drawn from — a pool of 1–2 means "mid-range" had nothing to choose from and the pick deserves a look.

## Edge Functions

### `fetch-recipe`

Server-side proxy that lets the **web build** import recipes from arbitrary URLs without hitting CORS. iOS/Android clients fetch directly and never call this function — the client only routes through it when `isWebRuntime() && supabaseConfigured` (see `src/utils/recipeUrlParser.ts`).

The function validates the URL (http(s) only, rejects loopback / RFC1918 / link-local hostnames to limit SSRF) and forwards a desktop User-Agent so recipe sites return the real HTML rather than a mobile shell.

**Deploy:**

```bash
supabase functions deploy fetch-recipe
```

JWT verification is on by default, so unauthenticated callers receive 401. No additional secrets need to be set.

**Test locally:**

```bash
supabase functions serve fetch-recipe
# then POST { "url": "https://example.com/some-recipe" } with an auth header
```

### `resolve-prices`

On-demand pricing. `src/lib/priceDemand.ts` sends the ingredient names currently on the grocery list (debounced 1.5s, single-flighted, 6h per-name cooldown); the function decides which are stale and resolves only those.

Per name it answers one of:

| Status | Meaning | Kroger call? |
| --- | --- | --- |
| `fresh` | Published price is inside `price_ttl_days` | no |
| `published` | Was stale, resolved and written just now | yes |
| `unknown` | No `price_sources` row — not in the catalog | no |
| `pending` | Another invocation holds the lease | no |
| `rejected` | Resolved but failed a gate; keeps its old price | yes |
| `disabled` | `ondemand_enabled` is off | no |

Three properties keep it cheap and safe. A name outside the catalog never triggers a call, which is both the known-ingredients-only rule and the guard against junk input burning quota. The server owns freshness, so the TTL is retuned in SQL rather than shipped in an app release. And `price_sources.last_resolved_at` doubles as a self-expiring lease, so two devices wanting the same stale ingredient produce one call, not two.

**Setup** — reuses the same Kroger credentials as the CI job:

```bash
supabase secrets set KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=...
supabase functions deploy resolve-prices
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The service role is required because `public.prices` deliberately has no insert policy.

**A note on the imports.** This function imports `scripts/lib/{krogerClient,krogerMatch,resolveIngredient}.ts` and `src/utils/{normalizeName,unitConversion}.ts` directly, rather than vendoring copies, so the matcher can't drift between the weekly job and the on-demand path. Deno resolves specifiers literally, so those imports carry explicit `.ts` extensions and the project sets `allowImportingTsExtensions` (safe: it is `noEmit`). Don't strip them — the deploy bundles the whole graph across the boundary.

Purchase profiles ride on `price_sources.purchase_profile` rather than being imported, because `src/utils/purchaseProfile.ts` reaches `findPrice` and therefore fuse.js. Without that column a bread SKU sized "24 oz" can't be priced per `each`, which would leave every count- and can-priced ingredient unable to refresh on demand.

**Test locally:**

```bash
supabase functions serve resolve-prices
# then POST { "names": ["ribeye steak"] } with an auth header
```

### `compute-nutrition`

Fallback macro calculator. When a recipe URL's JSON-LD lacks `proteinContent` / `carbohydrateContent` / `fatContent`, the client (see `src/utils/computeNutrition.ts`) calls this function with the raw ingredient strings; it forwards them to **CalorieNinjas** and returns per-serving macros that the AddRecipe form pre-fills with an "estimated" badge.

The function fails open: if the API key is not set or the upstream call errors, the response is `{ ok: false }` and the client silently skips the fallback — import behavior is unchanged from before this feature.

**One-time setup:**

1. Sign up for a free CalorieNinjas API key at [calorieninjas.com/api](https://calorieninjas.com/api) (100,000 requests/month free, no credit card).
2. Set the key as a Supabase secret:

   ```bash
   supabase secrets set CALORIENINJAS_API_KEY=your_api_key
   ```

3. Deploy:

   ```bash
   supabase functions deploy compute-nutrition
   ```

**Test locally:**

```bash
supabase functions serve compute-nutrition
# then POST { "ingredients": ["1 cup flour", "2 eggs"], "servings": 4 } with an auth header
```
