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
- `priceDatabase.json` — ~100 US prices, `name → { pricePerUnit, unit }` (consumed by `priceEstimator`/`priceLookup`); two-tier provenance: most entries are hand-estimates, but the ~13 keys listed in `scripts/lib/blsPriceMapping.ts`'s `BLS_SERIES` table are BLS-sourced and get silently overwritten by `npm run prices:refresh-bls` — don't hand-edit those without also updating (or removing) their mapping entry
- `purchaseProfiles.json` — how each item is *sold* (`sellUnit`/`packSize`/`grams`); only cross-family/whole-pack items need an entry, the rest default from `priceDatabase` (consumed by `purchaseProfile`)
- `mealCatalog.json` — ~88 shared meals driving auto meal-plans (`mealPlanner`); bundled offline source of truth, mirrored to `public.meals`
- `foodPreferences.json` — canonical cuisine + dietary keys (the only valid values for a meal's `cuisine` / `dietaryTags`)

When adding keywords/prices, use canonical units from `unitSynonyms.json`. Category keys are sorted by length at module init so `"chicken broth" → Pantry` correctly beats `"chicken" → Protein`.

### URL recipe import

`src/utils/recipeUrlParser.ts` fetches a page, regex-extracts every `<script type="application/ld+json">` block, and walks nested `@graph` / array structures looking for `@type` containing `"Recipe"`. It throws `RecipeParseError` with `kind: 'network' | 'not-found' | 'malformed'` — `AddRecipeScreen` differentiates these in its error UI and falls back to the manual-entry tab with the URL prefilled. Sites without JSON-LD or behind bot-protection will fail by design; the fallback path is the happy path for those.

### Navigation topology

`RootNavigator` (native stack) wraps `TabNavigator` (bottom tabs) plus three modal-style screens (`RecipeDetail`, `AddRecipe`, `Pantry`). Inside tab screens that navigate between tabs, use `useNavigation<BottomTabNavigationProp<TabParamList>>()` — the nested `navigation.getParent()?.navigate(...)` pattern was tried and produces fragile `never` types. Global declaration merging in `src/navigation/types.ts` gives untyped `useNavigation()` calls the right shape elsewhere.

### Theming

The app renders **one fixed palette** regardless of OS color scheme: the MealFlow "Liquid Glass" colorway — cool near-white `#F5F8F6` radial backdrop, translucent white glass surfaces, emerald `#2ECC71` primary, carrot-orange `#E67E22` accent, teal `#16A085` success/info, dark-slate `#34495E` text. Green/orange *text* roles route through the darker `primarySoftText`/`accentSoftText` tokens for contrast. It's defined in `src/theme/tokens.ts` and consumed everywhere via `useAppTheme()`, never `useColorScheme()`. Typography is Montserrat (400/500/600/700 via `@expo-google-fonts/montserrat`), loaded in `App.tsx` and referenced only through `tokens.font`. Icon/splash/favicon assets are generated from a vector mark by `npm run brand:assets` (`scripts/generateBrandAssets.mjs`).

**Gotcha:** the active palette is stored under the `dark` key in `tokens.ts` (and `darkTheme` in `theme.ts`) for backwards-compatible wiring — but it is a *light* theme (`useAppTheme()` returns `isDark: false, scheme: 'light'`, and `App.tsx` sets the navigation/status bar to light). The `light` palette object is unused. To change the colorway, edit the `dark` palette; don't be misled by the key name. `App.tsx` hardcodes the near-white `#F5F8F6` backdrop behind the navigator (and `AmbientBackground.tsx` hardcodes the matching radial-gradient stops), so change those too.

## Testing philosophy

Only the `src/utils/` modules have tests (see `src/__tests__/`). Screens are intentionally thin over stores + utils; verify UI changes by running the app. When adding a new pure utility, add a test alongside; when editing normalization, unit conversion, or the pipeline, expect to update multiple test files that share assumptions.

## Things that are easy to get wrong

- **Adding a new persisted store** — also wire it into `src/store/hydration.ts` and add a key to `STORAGE_KEYS`.
- **Adding a new unit** — add aliases to `unitSynonyms.json` *and* a row to `UNIT_TABLE` in `unitConversion.ts` with the correct family and base conversion *and* a label in `UNIT_LABELS` (`formatters.ts`) or it renders raw. Retail "pack" units (`block`/`bag`/`bottle`…) are `count` family with `toBase: 1`; cross-family pricing goes through purchase-profile `grams`, never `convert()`.
- **Adding a meal whose ingredient is sold discretely but priced by weight/volume** (e.g. an onion priced per `lb`, a spice used by `tsp`) — the default profile won't round a fractional `each`/won't price across families. Add an explicit `purchaseProfiles.json` entry with a `grams` bridge; `purchaseProfileCoverage.test.ts` fails on any catalog ingredient that rounds to a fractional count.
- **Adding a new ingredient category** — no enum; categories are just strings. Update the `ordered` array in `GroceryListScreen.tsx` if you want section ordering, otherwise it sorts last.
- **UUID on React Native** — `uuid` requires `react-native-get-random-values` imported *before* `uuid`. Existing stores do this; new ones that use `uuid` must too.
- **Editing the theme** — the live palette is the `dark` key in `src/theme/tokens.ts` even though it's a light/near-white theme; the `light` object is dead. Update `dark`, the hardcoded backdrop color in `App.tsx`, and the gradient stops in `AmbientBackground.tsx` together.
- **Adding a meal to `mealCatalog.json`** — every ingredient must resolve via `findPrice` *and* use a known unit or `mealCatalogPriceCoverage.test.ts` fails (usually add a row to `priceDatabase.json` + a keyword to `categoryKeywords.json`). `mealCatalog.test.ts` also enforces valid cuisine/dietary keys, calories > 0, and unique slug ids. Re-run `npm run seed:build` after edits.
- **Hardcoding an exact dollar price in a test for a BLS-mapped ingredient** — check `BLS_SERIES` in `scripts/lib/blsPriceMapping.ts` first; those prices drift on the next `npm run prices:refresh-bls` and will break the assertion (this happened to `priceEstimator.test.ts`'s chicken-breast assertions during this feature's own implementation). Pick a non-BLS-mapped item as a test fixture instead.
