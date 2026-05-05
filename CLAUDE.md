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
```

There is no lint script. TypeScript strict is the only static check.

## Architecture

Offline-first Expo + React Native app. No backend; all state lives in Zustand stores persisted to AsyncStorage. Business logic is isolated in pure functions under `src/utils/` so it's testable without RN.

### The grocery-list pipeline

This is the core compute path, invoked by `HomeScreen` and `GroceryListScreen`:

```
plan + recipes → aggregate() → applyPantry() → estimatePrices() → render
```

Each step is a pure function in `src/utils/`. All three take and return plain `GroceryItem[]` (see `src/types/index.ts`). Downstream screens recompute via `useMemo` over the store inputs. When editing this pipeline, prefer adding another pure step in the chain over mutating stores.

### Name normalization is load-bearing

`src/utils/normalizeName.ts` (lowercase + strip articles + naive singularize via an irregular-plurals table) is the join key across ingredient grouping, pantry matching, category lookup, price lookup, and price overrides. **All five call sites must use `normalizeName` or they won't match.** Changes here affect every merge/dedupe outcome — update tests in `ingredientAggregator.test.ts`, `pantryDeduction.test.ts`, and `priceEstimator.test.ts` together.

### Unit conversion is family-scoped

`src/utils/unitConversion.ts` exposes `convert(qty, from, to)` that returns `null` when the units are in different families (volume/weight/count). Callers must handle `null` explicitly:
- Aggregator: partitions entries by family and only merges within a family, so a recipe with `1 cup flour` and another with `100 g flour` produces two entries under one `GroceryItem`.
- Pantry: leaves the entry untouched when pantry unit and required unit are incompatible.
- Price: marks the entry `priceReason: 'unit-conflict'` and flags `hasPriceGap`.

Count units are a special case — distinct labels (`each` vs `slice`) never convert, even though they share a family.

### Stores and hydration

Five Zustand stores under `src/store/`, each with its own AsyncStorage key (see `STORAGE_KEYS` in `storage.ts`):
- `useRecipeStore`, `useMealPlanStore`, `usePantryStore`, `useSettingsStore`, `usePriceOverrideStore`

`useHydration()` in `src/store/hydration.ts` waits for all five to rehydrate before `App.tsx` renders the navigator — prevents a flash of empty state. Any new persisted store must be added to the `stores` array there or it will silently block hydration.

`seedIfFirstLaunch()` in `src/store/seedFirstLaunch.ts` runs once per install (gated by the `STORAGE_KEYS.seeded` flag) to insert sample recipes and a starter pantry. Don't seed from within store definitions — stores are hydrated before the flag is read.

### Data files as editable reference

Three JSON files in `src/data/` are hot-pathed by utilities:
- `unitSynonyms.json` — aliases → canonical unit (consumed by `ingredientParser`)
- `categoryKeywords.json` — longest-match-wins keyword → category map (consumed by `categorizer`)
- `priceDatabase.json` — ~100 US prices, `name → { pricePerUnit, unit }` (consumed by `priceEstimator`)

When adding keywords/prices, use canonical units from `unitSynonyms.json`. Category keys are sorted by length at module init so `"chicken broth" → Pantry` correctly beats `"chicken" → Protein`.

### URL recipe import

`src/utils/recipeUrlParser.ts` fetches a page, regex-extracts every `<script type="application/ld+json">` block, and walks nested `@graph` / array structures looking for `@type` containing `"Recipe"`. It throws `RecipeParseError` with `kind: 'network' | 'not-found' | 'malformed'` — `AddRecipeScreen` differentiates these in its error UI and falls back to the manual-entry tab with the URL prefilled. Sites without JSON-LD or behind bot-protection will fail by design; the fallback path is the happy path for those.

### Navigation topology

`RootNavigator` (native stack) wraps `TabNavigator` (bottom tabs) plus three modal-style screens (`RecipeDetail`, `AddRecipe`, `Pantry`). Inside tab screens that navigate between tabs, use `useNavigation<BottomTabNavigationProp<TabParamList>>()` — the nested `navigation.getParent()?.navigate(...)` pattern was tried and produces fragile `never` types. Global declaration merging in `src/navigation/types.ts` gives untyped `useNavigation()` calls the right shape elsewhere.

## Testing philosophy

Only the `src/utils/` modules have tests (see `src/__tests__/`). Screens are intentionally thin over stores + utils; verify UI changes by running the app. When adding a new pure utility, add a test alongside; when editing normalization, unit conversion, or the pipeline, expect to update multiple test files that share assumptions.

## Things that are easy to get wrong

- **Adding a new persisted store** — also wire it into `src/store/hydration.ts` and add a key to `STORAGE_KEYS`.
- **Adding a new unit** — add aliases to `unitSynonyms.json` *and* a row to `UNIT_TABLE` in `unitConversion.ts` with the correct family and base conversion.
- **Adding a new ingredient category** — no enum; categories are just strings. Update the `ordered` array in `GroceryListScreen.tsx` if you want section ordering, otherwise it sorts last.
- **UUID on React Native** — `uuid` requires `react-native-get-random-values` imported *before* `uuid`. Existing stores do this; new ones that use `uuid` must too.
