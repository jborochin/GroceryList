# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install deps (first time)
npx expo start           # Dev server — press i/a/w for iOS/Android/web
npm test                 # Jest suite (pure utilities)
npx jest <path>          # Run a single test file, e.g. src/__tests__/ingredientParser.test.ts
npx jest -t "plural"     # Filter by test name pattern
npm run typecheck        # tsc --noEmit (strict mode)
npm run seed:build       # regenerate supabase/seed_meals.sql from src/data/mealCatalog.json
npm run import:mealdb    # draft catalog meals from TheMealDB (writes SQL by default)
npm run prices:refresh-bls  # refresh ~13 grocery prices from live BLS data
npm run prices:seed-sources # regenerate supabase/seed_price_sources.sql from priceDatabase.json
npm run prices:find-locations 45202  # one-off: discover Kroger store ids for KROGER_LOCATION_IDS
npm run prices:refresh-kroger -- --dry-run  # resolve live prices and report, writing nothing
npm run prices:bootstrap -- --limit 50      # propose priceDatabase rows for new ingredients (writes nothing)
npm run prices:refresh-kroger -- --top-up --dry-run  # show the budgeted work order, spends no quota
npx supabase functions deploy resolve-prices        # on-demand pricing (needs KROGER_* secrets set)
npm run ig:probe -- <instagram-url>        # fetch + parse a live reel from the CLI (no native build needed)
npx supabase functions deploy fetch-recipe          # needed for Instagram import on web (preset: 'instagram')
eas build --profile development --platform ios      # share extension needs a native build; no Expo Go
```

There is no lint script. TypeScript strict is the only static check.

## Architecture

Offline-first Expo + React Native app. State lives in Zustand stores persisted to AsyncStorage, with a Supabase backend (auth, per-user sync, a shared meals catalog, edge functions) layered on top — the app stays fully usable offline and treats the server as a mirror. Business logic is isolated in pure functions under `src/utils/` so it's testable without RN.

### The grocery-list pipeline

This is the core compute path, invoked by `HomeScreen` and `GroceryListScreen`:

```
plan + groceryRecipes + recipes → aggregate() → applyPantry() → mergeManualItems() → roundToPurchasable() → applyItemOverrides() → estimatePrices() → render
```

Each step is a pure function in `src/utils/` that takes and returns plain `GroceryItem[]` (see `src/types/index.ts`). Downstream screens recompute via `useMemo` over the store inputs. When editing this pipeline, prefer adding another pure step in the chain over mutating stores.

`aggregate()` is fed **two** entry sources concatenated: the meal plan (`useMealPlanStore`) and grocery-only recipe adds (`useGroceryRecipeStore`, the "Add to grocery list" button on the Recipe/Meal-Catalog detail screens). Grocery-only adds are additive — a recipe in both lists contributes twice (an intentional double batch) — and deliberately never reach the Week tab or the nutrition summary, which read plan entries only. They persist device-locally and are **not** synced.

`roundToPurchasable()` (`src/utils/purchaseRounding.ts`) rewrites each item's quantity into the unit the store actually sells it in, rounded up to a whole pack — `½ avocado → 1`, `1 cup broccoli → 1 head`, `2 cloves garlic → 1 head`, `1 oz cheddar → 1 block`. It runs **after** pantry (so owned staples are already gone) and **before** pricing (so the total reflects the real purchase). It only rounds items whose *sell unit* is a count (each/head/block/bag/bottle…); weight/volume sell units (chicken by the lb) stay continuous since you can buy a fraction. See "Purchase profiles" below.

`applyItemOverrides()` (`src/utils/applyItemOverrides.ts`) applies user edits to an item's displayName/quantity/unit/category, made via the pencil icon on a grocery row (`EditItemSheet`) and persisted in `useItemOverrideStore`, keyed by the item's normalized `name` — same keying convention as `usePriceOverrideStore`. It runs **after** rounding (a typed quantity shouldn't be re-rounded to a pack size) and **before** pricing (so the edited quantity/unit gets priced). It never rewrites `name` itself, only `displayName` — renaming is cosmetic, not a re-key.

### Name normalization is load-bearing

`src/utils/normalizeName.ts` (lowercase + strip articles + naive singularize via an irregular-plurals table) is the join key across ingredient grouping, pantry matching, category lookup, price lookup, and price overrides. **All five call sites must use `normalizeName` or they won't match.** Changes here affect every merge/dedupe outcome — update tests in `ingredientAggregator.test.ts`, `pantryDeduction.test.ts`, and `priceEstimator.test.ts` together.

### Unit conversion is family-scoped

`src/utils/unitConversion.ts` exposes `convert(qty, from, to)` that returns `null` when the units are in different families (volume/weight/count). Callers must handle `null` explicitly:
- Aggregator: partitions entries by family and only merges within a family, so a recipe with `1 cup flour` and another with `100 g flour` produces two entries under one `GroceryItem`.
- Pantry: leaves the entry untouched when pantry unit and required unit are incompatible.
- Price: marks the entry `priceReason: 'unit-conflict'` and flags `hasPriceGap`.

Count units are a special case — distinct labels (`each` vs `slice`) never convert, even though they share a family.

### Purchase profiles bridge unit families (deliberately, outside `convert()`)

`src/data/purchaseProfiles.json` + `src/utils/purchaseProfile.ts` model how each ingredient is *sold* (`sellUnit`, `packSize`, optional `grams`). `getProfile(name)` returns an explicit entry (exact normalized match) or a default derived from the item's `priceDatabase` row (`sellUnit = price unit, packSize 1`), so every priced ingredient has a profile. `convertMeasure(qty, from, to, profile)` is the **only** place that crosses unit families: it tries `convert()` first, then bridges via `grams` (weight↔grams is universal mass; volume/count units need a `grams` anchor). This is intentionally kept out of `convert()` so the rest of the pipeline's family isolation stays intact. Both `roundToPurchasable` and `estimatePrices` use it — the latter so a cross-family sell unit (broccoli `head` priced per `lb`) prices instead of flagging `unit-conflict`.

### Live prices overlay the bundled ones

`findPrice()` resolves in these steps: **user override → live overlay → bundled exact → substring (specific) → substring (generic) → fuzzy**.

The two substring passes are not a micro-optimization. Containment is bidirectional and the directions want *opposite* winners: a catalog key found inside the query should resolve to the **most specific** match (`"boneless ribeye steak"` → `ribeye steak`), while a query found inside a catalog key should resolve to the **most generic** (`"steak"` → `beef steak`, not whichever cut sorts longest). One sorted scan cannot serve both, so there are two arrays sorted opposite ways, ordered by character length with an alphabetical tiebreak — never by file position. Matching is token-wise, not raw `includes`, or `"graham cracker"` resolves to the `ham` row.

The live overlay is `public.prices`, written by **two** paths (Kroger Products API, service-role write):

- **On demand** — `supabase/functions/resolve-prices`. The grocery list sends its visible ingredient names (debounced, via `src/lib/priceDemand.ts`); the function resolves only those stale past `price_ttl_days` and returns fresh rows, which `mergeRows()` folds into the cache. Resolves against 1–3 stores because someone is waiting.
- **Weekly top-up** — `.github/workflows/refresh-prices.yml` running `scripts/refreshKrogerPrices.ts --top-up`. Keeps the accurate 12-store median but only for rows stale past the TTL, ordered by `public.ingredient_demand`, capped by `topup_run_call_budget`. A full sweep no longer fits the quota: 520 keys × 12 stores ≈ 6,200 calls against 10,000/day.

The app reads the overlay through `src/lib/priceCatalogSync.ts`, a direct analogue of `mealCatalogSync.ts` — synchronous accessor over a module-level cache, AsyncStorage-backed, fire-and-forget refresh fired once from `App.tsx`.

**`install()` vs `mergeRows()`** — `install()` *replaces* the cache and is right only for a full-table refresh. An on-demand response carries a handful of names, so it must merge; using `install()` there would drop every other live price. Both run rows through the same `ingestRows` validation.

**Everything tunable lives in `public.app_config`** (public-read, service-role-write): `price_ttl_days`, `ondemand_enabled` (kill switch), `ondemand_batch_max`, `ondemand_store_count`, `ondemand_lease_seconds`, `topup_run_call_budget`, `demand_promote_threshold`. Values are read as jsonb and coerced, and the boolean **fails safe** — a hand-written `set value = '"false"'` still disables. Change freshness with one statement, no redeploy:

```sql
update public.app_config set value = '7'::jsonb where key = 'price_ttl_days';
```

**Concurrency** — `price_sources.last_resolved_at` doubles as a self-expiring lease. A conditional update only matches a row untouched inside `ondemand_lease_seconds`, so two devices wanting the same stale ingredient produce one Kroger call; the loser gets `pending`.

**`public.ingredient_demand`** counts requests per normalized name (no `user_id` — it is an aggregate, so there is no per-user data to protect). It orders the top-up, and names with `in_catalog = false` are the enrollment queue: `--top-up` prints those past `demand_promote_threshold` for the next `prices:bootstrap` batch.

**The edge function shares the matcher rather than copying it** — it imports `scripts/lib/{krogerMatch,resolveIngredient,krogerClient}.ts` and `src/utils/{normalizeName,unitConversion}.ts` directly. That requires explicit `.ts` extensions on that import chain (Deno resolves specifiers literally) and `allowImportingTsExtensions` in tsconfig, which is safe because the project is `noEmit`. Don't strip those extensions. Purchase profiles ride on `price_sources.purchase_profile` because the function cannot import `purchaseProfile.ts` (it reaches `findPrice` → fuse.js), and without a `grams` anchor a bread SKU sized "24 oz" can't be priced per `each`.

Three properties hold this together:

- **The bundled `priceDatabase.json` is still the floor and still the test-enforced source of truth.** An empty, stale, or missing overlay means exactly today's behavior. `truncate public.prices` is the kill switch.
- **The overlay may restate a price but never its unit.** `getProfile()` derives its sell unit from the price entry (`purchaseProfile.ts:38`) and `roundToPurchasable()` branches on that unit's family, so a unit change would silently alter rounding. Enforced twice: the refresh script rejects conversions it can't land in `baseline_unit`, and `ingestRows()` drops mismatched rows client-side.
- **The overlay is consulted on exact normalized match only.** Substring and fuzzy stay on the bundled DB, so unknown-name behavior is unchanged.

Rows older than 60 days are dropped on read, so a dead refresh job decays back to bundled prices rather than freezing. Because `findPrice` reads a module-level cache React can't see, `usePriceCatalogStore` (non-persisted — do **not** add it to `hydration.ts`) carries a version counter that both pricing `useMemo`s depend on.

`public.price_sources` is the internal mapping/review table (RLS on, **zero policies** — service role only). New ingredients enroll themselves: add the `priceDatabase.json` row, run `npm run prices:seed-sources`, apply the SQL, and the next weekly run auto-matches it. An unreviewed match only publishes if it clears `scoreMatch` ≥ 0.6 and a 0.25×–4× sanity band against the bundled price; rejections fall through to the hand-estimate and land in the run's review report.

**Candidates are filtered on Kroger's own aisle categories before any text scoring** (`hasFoodCategory`, `krogerMatch.ts`). Text gates compare a description to a search term and cannot tell food from non-food: searching `"hanger"` returns "Project Partners Large Picture Hangers - Gold", which carries the head noun, trips no trap token, scores 1.00, and prices out at $39.90/lb. `FOOD_CATEGORIES` is an **allowlist**, deliberately — a missing food aisle rejects a real match (safe: falls back to the bundled estimate, and shows up as `non-food-category` in the run report), whereas a missing non-food aisle ships hardware as a grocery price. Products with no category data are treated as "maybe" and left to the text gates.

**The blend-veto noun set is frozen** in `scripts/lib/blendVetoNouns.ts`, not derived from `priceDatabase.json`. Deriving it coupled matcher behavior to catalog size — every new single-word price key made the co-occurrence veto fire more often, so the tuned live-regression cases would drift as the catalog grows. Freezing it also removed the matcher's last JSON import.

**The resolver is Deno-portable** (`scripts/lib/resolveIngredient.ts`), shared by the weekly refresh, `prices:bootstrap`, and (planned) the on-demand edge function. It takes `PurchaseProfile` and `convertMeasure` as **injected** parameters rather than importing them, because `getProfile()` reaches `findPrice` and therefore fuse.js. `baselinePricePerUnit: null` means "no baseline yet" and skips the sanity band — only the bootstrap path uses it, and its contract is that a human reviews the result before it becomes a price.

**Candidate selection targets the mid-priced SKU, not the cheapest** (`pickMedianBy`). Retail search spans store brand to premium, and taking the bottom of that spread biases totals ~30% low against the bundled/BLS baseline — BLS averages all brands and cuts, whereas a store brand is the floor. Measured live over 10 ingredients: cheapest = −31% vs bundled, median = −3%. Two levels of median run: across candidate SKUs at the primary store (free — the search response already carries price and size), then across the 12 reference stores in `KROGER_REFERENCE_LOCATIONS` for the chosen SKU.

### Stores and hydration

Nine persisted Zustand stores under `src/store/`, each with its own AsyncStorage key (see `STORAGE_KEYS` in `storage.ts`): `useRecipeStore`, `useMealPlanStore`, `usePantryStore`, `useManualItemStore`, `useGroceryRecipeStore` (recipes added straight to the grocery list, off-plan), `useDismissedItemStore`, `useSettingsStore`, `usePriceOverrideStore`, `useItemOverrideStore` (name/quantity/unit/category edits from the grocery-row pencil icon). Plus `useAuthStore` (Supabase session — initialized separately in `hydration.ts`, not in the persist array) and `useSyncStateStore` (sync metadata).

`useHydration()` in `src/store/hydration.ts` waits for all five to rehydrate before `App.tsx` renders the navigator — prevents a flash of empty state. Any new persisted store must be added to the `stores` array there or it will silently block hydration.

`seedIfFirstLaunch()` in `src/store/seedFirstLaunch.ts` runs once per install (gated by the `STORAGE_KEYS.seeded` flag) to insert sample recipes and a starter pantry. Don't seed from within store definitions — stores are hydrated before the flag is read. It skips seeding when a Supabase session exists (account state arrives via sync).

### Supabase backend & the shared meal catalog

`supabase/schema.sql` defines per-user tables (RLS, synced from device) plus a shared `public.meals` catalog that is **public-read, service-role-write only** (no client write policy). Two edge functions: `compute-nutrition` (CalorieNinjas, keeps the key server-side) and `fetch-recipe` (server-side URL fetch for web / bot-protected sites).

The catalog is two-tier: bundled `src/data/mealCatalog.json` is the offline source of truth; `public.meals` is its updatable mirror, pulled fire-and-forget by `refreshMealCatalogCache()` in `src/lib/mealCatalogSync.ts` (falls back to the bundled JSON). `mealPlanner.ts` consumes it — filters hard on `dietaryTags`, weights protein 3×, bonuses preferred `cuisine`.

To change the catalog, see the `update-meal-catalog` skill.

### Data files as editable reference

Six JSON files in `src/data/` are hot-pathed by utilities:
- `unitSynonyms.json` — aliases → canonical unit (consumed by `ingredientParser`)
- `categoryKeywords.json` — longest-match-wins keyword → category map (consumed by `categorizer`)
- `priceDatabase.json` — US prices, `name → { pricePerUnit, unit }` (consumed by `priceEstimator`/`priceLookup`); three-tier provenance: older entries are hand-estimates, the ~13 keys listed in `scripts/lib/blsPriceMapping.ts`'s `BLS_SERIES` table are BLS-sourced and get silently overwritten by `npm run prices:refresh-bls` (don't hand-edit those without also updating or removing their mapping entry), and newer entries come from `npm run prices:bootstrap` — resolved against live Kroger and reviewed by a human before commit. Every key is also the enrollment list for live pricing (see "Live prices overlay the bundled ones"), so a new key needs `npm run prices:seed-sources` re-run. The catalog is deliberately **specific, not generic**: `ribeye steak` / `filet mignon` / `round steak` are separate rows because they span $10.99–$45.98/lb, and one averaged `beef steak` row mis-budgets every one of them. Generic rows stay as fallbacks — the two substring passes let both coexist. `src/__tests__/priceCatalogConsistency.test.ts` enforces the structural rules (no normalized-name collisions, real category, known + labelled unit, resolves to itself)
- `purchaseProfiles.json` — how each item is *sold* (`sellUnit`/`packSize`/`grams`); only cross-family/whole-pack items need an entry, the rest default from `priceDatabase` (consumed by `purchaseProfile`)
- `mealCatalog.json` — ~88 shared meals driving auto meal-plans (`mealPlanner`); bundled offline source of truth, mirrored to `public.meals`
- `foodPreferences.json` — canonical cuisine + dietary keys (the only valid values for a meal's `cuisine` / `dietaryTags`)

When adding keywords/prices, use canonical units from `unitSynonyms.json`. Category keys are sorted by length at module init so `"chicken broth" → Pantry` correctly beats `"chicken" → Protein`.

### URL recipe import

`src/utils/recipeUrlParser.ts` fetches a page, regex-extracts every `<script type="application/ld+json">` block, and walks nested `@graph` / array structures looking for `@type` containing `"Recipe"`. It throws `RecipeParseError` with `kind: 'network' | 'not-found' | 'malformed'` — `AddRecipeScreen` differentiates these in its error UI and falls back to the manual-entry tab with the URL prefilled. Sites without JSON-LD or behind bot-protection will fail by design; the fallback path is the happy path for those.

### Instagram recipe import (share sheet → recipe)

`expo-share-intent` puts MealFlow in the OS share sheet, so sharing a reel from Instagram opens `AddRecipe` with the recipe already parsed. The chain:

```
share sheet → ShareIntentProvider → useShareIntentRouter → parseSharedUrl()
  ├─ instagram → importInstagramRecipe() → extractCaptionFromHtml() → parseRecipeFromCaption()
  └─ anything else → parseRecipeFromUrl()   (the JSON-LD path above)
```

**The crawler User-Agent is load-bearing, not an optimization.** Instagram renders posts client-side: requested with a browser UA, `instagram.com/p/<code>/` returns a ~600KB JavaScript shell with no caption and *no og tags at all*. Requested as `facebookexternalhit/1.1`, the same URL serves the **complete caption** in `og:description` / `<meta name="description">` / `og:title`, with **real newlines preserved inside the attribute value** — which is the only reason the line-based `parseRecipeFromCaption` works on it. Don't "fix" `INSTAGRAM_HEADERS` (`instagramImport.ts`) to look more like a browser; that silently breaks every import. The `/embed/captioned/` endpoint older scrapers used is dead — it now returns the same shell for every shortcode.

There is no official API for this (oEmbed needs App Review; the Graph API only covers posts you own), so the paste-the-caption box stays permanently as the fallback. Roughly **one recipe reel in three can't be auto-parsed** — plenty keep the recipe in the video or a link in bio — so `InstagramImportError.recoveredCaption` carries the caption back to the screen, which drops it into that box already filled in. That is a routine path, not an error to chase.

- **Native fetches instagram.com directly; web can't** (CORS) and routes through `fetch-recipe` with `preset: 'instagram'`, which swaps in the crawler headers server-side. Callers sending no preset keep the browser headers, so the URL importer is unaffected. **Whether Instagram serves meta tags to Supabase's datacenter IPs is unverified** — the share extension is native-only, so this only affects the web build.
- **`npm run ig:probe -- <url>`** runs the whole fetch → caption → recipe path from the CLI. Since the share extension needs a native build (it cannot run in Expo Go), this is the fast iteration loop — and on Windows it is the only way to exercise it at all.
- **Share routing is imperative, through the navigation container ref** (`App.tsx` → `ShareIntentRouter`). The package's README prescribes a React Navigation linking config, but that is only needed to route declaratively; the provider gets its URL from `expo-linking`'s `useLinkingURL` plus a native event and an app-active refresh, independently of navigation. This app has never had a linking config and doesn't need one. The router clears non-importable shares (an image, a profile link) or the provider re-offers them on every foreground.
- **`expo-share-intent` is pinned to `~5.1.1`** — the release whose peer range is `expo: ^54`. 6.x wants 55, 7.x wants 56, 8.x wants 57. Don't bump it without bumping Expo.
- **Adding a new dependency requires restarting Metro.** A dev server started before the install keeps a stale module map and fails with `Unable to resolve module ./ShareIntentProvider` even though the file is on disk. `npx expo start --web --clear`.

### Navigation topology

`RootNavigator` (native stack) wraps `TabNavigator` (bottom tabs) plus three modal-style screens (`RecipeDetail`, `AddRecipe`, `Pantry`). Inside tab screens that navigate between tabs, use `useNavigation<BottomTabNavigationProp<TabParamList>>()` — the nested `navigation.getParent()?.navigate(...)` pattern was tried and produces fragile `never` types. Global declaration merging in `src/navigation/types.ts` gives untyped `useNavigation()` calls the right shape elsewhere.

### Theming

The app renders **one fixed palette** regardless of OS color scheme: the MealFlow "Liquid Glass" colorway — cool near-white `#F5F8F6` radial backdrop, translucent white glass surfaces, emerald `#2ECC71` primary, carrot-orange `#E67E22` accent, teal `#16A085` success/info, dark-slate `#34495E` text. Green/orange *text* roles route through the darker `primarySoftText`/`accentSoftText` tokens for contrast. It's defined in `src/theme/tokens.ts` and consumed everywhere via `useAppTheme()`, never `useColorScheme()`. Typography is Montserrat (400/500/600/700 via `@expo-google-fonts/montserrat`), loaded in `App.tsx` and referenced only through `tokens.font`. Icon/splash/favicon assets are generated from a vector mark by `npm run brand:assets` (`scripts/generateBrandAssets.mjs`).

**Gotcha:** the active palette is stored under the `dark` key in `tokens.ts` (and `darkTheme` in `theme.ts`) for backwards-compatible wiring — but it is a *light* theme (`useAppTheme()` returns `isDark: false, scheme: 'light'`, and `App.tsx` sets the navigation/status bar to light). The `light` palette object is unused. To change the colorway, edit the `dark` palette; don't be misled by the key name. `App.tsx` hardcodes the near-white `#F5F8F6` backdrop behind the navigator (and `AmbientBackground.tsx` hardcodes the matching radial-gradient stops), so change those too.

## Testing philosophy

Only the `src/utils/` modules have tests (see `src/__tests__/`). Screens are intentionally thin over stores + utils; verify UI changes by running the app. When adding a new pure utility, add a test alongside; when editing normalization, unit conversion, or the pipeline, expect to update multiple test files that share assumptions.

## Things that are easy to get wrong

- **Adding a new persisted store** — also wire it into `src/store/hydration.ts` and add a key to `STORAGE_KEYS`.
- **Adding a new unit** — add aliases to `unitSynonyms.json` *and* a row to `UNIT_TABLE` in `unitConversion.ts` with the correct family and base conversion *and* a label in `UNIT_LABELS` (`formatters.ts`) or it renders raw. Note that `unitSynonyms.json` now also drives `splitGluedUnits` (below), so a new alias immediately becomes something a digit can be split from.
- **Quantities glued to their unit** — `parseIngredient` runs `splitGluedUnits` (`ingredientParser.ts`) so `"300g pasta"` → `300 g pasta`. Instagram captions write metric quantities this way almost universally, and without it `extractQuantity` (which tokenizes on spaces) found no number and the line became `1 each :: "300g pasta"` — unpriceable and un-aggregatable. **The split is driven by the alias table itself, not a generic letter run**, which is what protects `9x13`, `7up`, `350f` and `1st`. Known accepted false positive: `180c` → `180 cup`, since `c` is a cup alias — oven temperatures live in instructions, not ingredient lines. A caption writing the quantity *after* the name (`"Chicken - 200-300 grams"`) is still not recovered; that's asserted as a documented limitation in `instagramCaption.test.ts`. Retail "pack" units (`block`/`bag`/`bottle`…) are `count` family with `toBase: 1`; cross-family pricing goes through purchase-profile `grams`, never `convert()`.
- **Adding a meal whose ingredient is sold discretely but priced by weight/volume** (e.g. an onion priced per `lb`, a spice used by `tsp`) — the default profile won't round a fractional `each`/won't price across families. Add an explicit `purchaseProfiles.json` entry with a `grams` bridge; `purchaseProfileCoverage.test.ts` fails on any catalog ingredient that rounds to a fractional count.
- **Adding a new ingredient category** — no enum; categories are just strings. Update the `ordered` array in `GroceryListScreen.tsx` if you want section ordering, otherwise it sorts last.
- **UUID on React Native** — `uuid` requires `react-native-get-random-values` imported *before* `uuid`. Existing stores do this; new ones that use `uuid` must too.
- **Editing the theme** — the live palette is the `dark` key in `src/theme/tokens.ts` even though it's a light/near-white theme; the `light` object is dead. Update `dark`, the hardcoded backdrop color in `App.tsx`, and the gradient stops in `AmbientBackground.tsx` together.
- **Adding a price key by hand** — prefer `npm run prices:bootstrap` so the price comes from Kroger rather than from guesswork. Either way `priceCatalogConsistency.test.ts` will fail the key if it collides with an existing key once normalized, lands in the `Other` category, or uses a unit missing from `UNIT_TABLE`/`UNIT_LABELS`. Keep the naming convention `<modifier> <head noun>` where the head noun is an existing generic key — `scoreMatch` requires the search term's *last* token to appear in the SKU description, and both substring passes depend on it.
- **Choosing a bootstrap search term** — keep a food head noun in it. `"hanger"` matched picture hangers; `"hanger steak"` matched nothing (Kroger doesn't stock it). A `Pool` of 1 in the report means "mid-priced" had nothing to choose from, so the pick is whatever single SKU matched — often the premium private label. Widening the term (`"new york strip steak"` → `"strip steak"`) took that pool from 1 to 9 and the price from $23.99 to $20.99.
- **Adding a meal to `mealCatalog.json`** — every ingredient must resolve via `findPrice` *and* use a known unit or `mealCatalogPriceCoverage.test.ts` fails (usually add a row to `priceDatabase.json` + a keyword to `categoryKeywords.json`). `mealCatalog.test.ts` also enforces valid cuisine/dietary keys, calories > 0, and unique slug ids. Re-run `npm run seed:build` after edits.
- **Hardcoding an exact dollar price in a test** — two independent sources of drift now. `BLS_SERIES` in `scripts/lib/blsPriceMapping.ts` rewrites ~13 bundled prices on `npm run prices:refresh-bls` (this broke `priceEstimator.test.ts`'s chicken-breast assertions once already). Separately, *any* ingredient can be overlaid by the weekly live refresh. Tests never see the overlay unless they seed it (the module cache starts empty), so bundled-price assertions are safe — but assert against a non-BLS-mapped fixture like `tofu`, and seed live prices explicitly via `loadPriceCache()` rather than expecting them.
- **Adding a persisted store vs. `usePriceCatalogStore`** — that one is deliberately *not* persisted and must stay out of `hydration.ts`; adding it there would block hydration forever waiting for a rehydrate that never fires.
