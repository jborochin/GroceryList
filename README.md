# MealPrep Grocery

An offline-first React Native + Expo app for weekly meal prep planning. Aggregates recipes into a consolidated grocery list with category grouping, pantry deduction, nutrition tracking, and price estimation.

Runs on iOS, Android, and web (via Expo) with no backend.

## Quick start

```bash
npm install
npx expo start
```

Then choose where to run:
- Press `i` → iOS simulator (requires Xcode)
- Press `a` → Android emulator (requires Android Studio)
- Press `w` → web browser
- Scan the QR code with the **Expo Go** app on a physical device

## Features

- **Recipe library** — add recipes manually or import from any URL with a schema.org/Recipe JSON-LD block
- **Servings scaling** — preview or permanently rescale a recipe's quantities and nutrition
- **Weekly meal plan** — choose recipes and desired servings
- **Consolidated grocery list** — ingredients merged across recipes, with unit conversion (tsp↔tbsp↔cup, g↔kg, oz↔lb), grouped by category, sorted for a store aisle path
- **Pantry deduction** — pantry items with a quantity are subtracted from the list; items without a quantity are excluded entirely
- **Nutrition tracking** — daily calorie target + macro split; weekly and daily summaries with variance from goal
- **Price estimation** — ~100 seeded US grocery prices with fuzzy matching; tap any row to set a custom price override
- **Share** — native share sheet exports the list as plain text

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run Expo dev server |
| `npm test` | Run Jest unit tests |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run ios` / `npm run android` / `npm run web` | Start on a specific target |

## Architecture

```
src/
├── types/          # TypeScript types (Recipe, Ingredient, GroceryItem, …)
├── store/          # Zustand stores, persisted to AsyncStorage
├── utils/          # Pure functions (parsing, unit conversion, aggregation, pricing, nutrition)
├── data/           # Reference JSON (units, categories, prices) + seed recipes
├── navigation/     # React Navigation (bottom tabs + stack)
├── components/     # Reusable UI (RecipeCard, NutritionBar, …)
├── screens/        # One file per screen
└── __tests__/      # Jest unit tests for utils
```

### Data flow for grocery list generation

```
plan + recipes → aggregate() → applyPantry() → estimatePrices() → render
```

Each step is a pure function over data held in Zustand; the screen recomputes via `useMemo` when any input changes.

## Extending the app

### Add more grocery prices

Edit `src/data/priceDatabase.json`. Keys are canonical ingredient names; values are `{ pricePerUnit, unit }` where the unit matches one of the canonical forms in `src/data/unitSynonyms.json`.

Users can also set in-app per-ingredient overrides (long-tap a price on the grocery list).

### Add category keywords

Edit `src/data/categoryKeywords.json`. Keys are lowercase substrings; values are category labels. Longer keys win over shorter (so `"chicken broth" → Pantry` beats `"chicken" → Protein`).

### Add unit aliases

Edit `src/data/unitSynonyms.json`. Each canonical unit lists its aliases. The ingredient parser matches aliases against raw strings like `"2 tablespoons olive oil"`.

### URL recipe parsing

`src/utils/recipeUrlParser.ts` fetches a URL, extracts every `<script type="application/ld+json">` block, and looks for any node whose `@type` includes `"Recipe"`. Sites that don't embed JSON-LD (or are behind aggressive bot-protection) will fail gracefully — the Add Recipe screen surfaces the error and offers manual entry.

## Testing

The Jest suite (`npm test`) covers the pure utilities:

- Ingredient parsing (fractions, units, parentheticals, synonyms)
- Unit conversion across volume/weight families
- Cross-recipe aggregation with plural normalization
- Pantry deduction with unit conversion
- Price estimation (exact match, substring, fuzzy, overrides, unit conversion)
- JSON-LD extraction and Recipe node discovery

There are intentionally no tests against the UI — the screens are thin over the utilities and stores. Verify UI changes by running the app.

## Seed data

On first launch, the app inserts:
- 3 sample recipes (sheet-pan chicken, overnight oats, beef stir-fry)
- A starter pantry (salt, pepper, olive oil, soy sauce)

To reset: Settings → Reset all data.

## Out of scope (for this version)

- Accounts / cloud sync (everything is local)
- Live store pricing APIs
- Barcode scanning, image OCR

## Tech

Expo SDK 51 · React Native 0.74 · TypeScript · Zustand · React Navigation 6 · React Native Paper (MD3) · Fuse.js · AsyncStorage
# GroveryList
