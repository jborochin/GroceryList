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
| `prices` | Weekly live ingredient prices (national averages) | `src/data/priceDatabase.json` | `src/lib/priceCatalogSync.ts` |
| `price_sources` | Ingredient → retail SKU mapping and review state | — | none (internal) |

`price_sources` goes further: RLS is enabled with **zero policies**, so no anon or authenticated client can read it at all.

## Live price refresh

`public.prices` is an overlay `findPrice()` consults ahead of the bundled prices. `truncate public.prices` reverts every device on its next refresh, and rows older than 60 days are ignored client-side, so a dead refresh job decays back to bundled prices instead of freezing.

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

The workflow runs weekly and on manual dispatch (with a dry-run option). Dry-run locally first:

```bash
npm run prices:refresh-kroger -- --dry-run
```

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
