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
