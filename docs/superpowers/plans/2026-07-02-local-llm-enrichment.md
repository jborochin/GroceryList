# Local LLM Ingredient Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich each new ingredient line once via a self-hosted Ollama LLM (category + purchase profile + re-parsed qty/unit), cache the result forever, and have the existing pure pipeline prefer the cached enrichment over its static-data fallback — while staying fully usable offline.

**Architecture:** A persisted Zustand store (`useIngredientEnrichmentStore`) holds LLM results keyed by normalized raw line. It mirrors those results into a pure in-memory index module (`enrichmentLookup.ts`) that `categorize()`, `getProfile()`, and `aggregate()` consult *before* their existing logic. A fire-and-forget queue calls Ollama over the network (reached from the phone via Tailscale) when a new raw line appears; on failure the deterministic path is used and the line is retried later. The store is never imported by the pure utils (it pulls AsyncStorage, which breaks the node/ts-jest test env), so all pipeline integration is tested through the pure lookup module.

**Tech Stack:** React Native / Expo (managed), Zustand + `persist`/AsyncStorage, TypeScript strict, Jest + ts-jest (node env), Ollama `/api/chat` structured-output mode.

## Global Constraints

- TypeScript strict mode is the only static check — `npm run typecheck` must pass (no `any` leaks, handle `null`/`undefined` explicitly).
- Pure `src/utils/` modules MUST NOT import any `src/store/*` module or `AsyncStorage` (directly or transitively) — the `ts-jest` node test env has no native modules. Utils read enrichment only through `src/utils/enrichmentLookup.ts`.
- Every new persisted store MUST be added to the `stores` array in `src/store/hydration.ts` and get a key in `STORAGE_KEYS` (`src/store/storage.ts`), or hydration silently blocks forever.
- Enrichment is **off by default**. When `settings.ollamaEnabled` is false, no network call fires and behavior is byte-for-byte identical to today.
- The deterministic pipeline is the always-available fallback: existing tests in `ingredientAggregator.test.ts`, `priceEstimator.test.ts`, `mergeManualItems.test.ts`, etc. MUST keep passing unchanged (empty lookup index ⇒ current behavior).
- Category values are constrained to the app's existing set, derived from `Object.values(categoryKeywords.json)` plus `'Other'` — the model may not invent categories.
- Network calls use a ~5s timeout and "fail open" (return null, never throw to the UI) — mirror `src/utils/computeNutrition.ts`.
- Run `npm test` and `npm run typecheck` at the end of every task; both must be green before committing.

---

### Task 1: Pure enrichment lookup index

**Files:**
- Create: `src/utils/enrichmentLookup.ts`
- Test: `src/__tests__/enrichmentLookup.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `src/utils/normalizeName.ts`.
- Produces:
  - `interface EnrichmentResult { quantity: number | null; unit: string | null; name: string; category: string; sellUnit: string; packSize: number; grams: Record<string, number> | null; }`
  - `rawKey(raw: string): string` — canonical key for a raw ingredient line.
  - `setEnrichmentIndex(byRawLine: Record<string, EnrichmentResult>): void` — replace the in-memory index.
  - `getEnrichmentByName(name: string): EnrichmentResult | null` — match by `normalizeName(result.name)`.
  - `getEnrichmentByRaw(raw: string): EnrichmentResult | null` — match by `rawKey(raw)`.

This module holds module-level mutable maps. It has NO store/AsyncStorage import, so pure utils can depend on it safely. The store (Task 2) mirrors its state into here via `setEnrichmentIndex`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/enrichmentLookup.test.ts
import {
  EnrichmentResult,
  rawKey,
  setEnrichmentIndex,
  getEnrichmentByName,
  getEnrichmentByRaw,
} from '../utils/enrichmentLookup';

function result(over: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    quantity: 1,
    unit: 'each',
    name: 'bell pepper',
    category: 'Produce',
    sellUnit: 'each',
    packSize: 1,
    grams: { tbsp: 9 },
    ...over,
  };
}

describe('enrichmentLookup', () => {
  beforeEach(() => setEnrichmentIndex({}));

  it('returns null when the index is empty', () => {
    expect(getEnrichmentByName('bell pepper')).toBeNull();
    expect(getEnrichmentByRaw('2 tbsp diced bell pepper')).toBeNull();
  });

  it('rawKey lowercases, trims, and collapses whitespace', () => {
    expect(rawKey('  2 TBSP   diced Bell Pepper ')).toBe('2 tbsp diced bell pepper');
  });

  it('looks up by raw line via rawKey', () => {
    const r = result({});
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: r });
    expect(getEnrichmentByRaw('2 TBSP diced bell pepper')).toEqual(r);
    expect(getEnrichmentByRaw('unrelated line')).toBeNull();
  });

  it('looks up by normalized ingredient name across differing raw phrasings', () => {
    const r = result({ name: 'Bell Peppers' });
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: r });
    // "bell peppers" -> normalizeName -> "bell pepper" matches r.name normalized
    expect(getEnrichmentByName('bell peppers')).toEqual(r);
    expect(getEnrichmentByName('sirloin steak')).toBeNull();
  });

  it('setEnrichmentIndex replaces (not merges) prior state', () => {
    setEnrichmentIndex({ [rawKey('a')]: result({ name: 'apple' }) });
    setEnrichmentIndex({ [rawKey('b')]: result({ name: 'banana' }) });
    expect(getEnrichmentByName('apple')).toBeNull();
    expect(getEnrichmentByName('banana')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/enrichmentLookup.test.ts`
Expected: FAIL — `Cannot find module '../utils/enrichmentLookup'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/enrichmentLookup.ts
import { normalizeName } from './normalizeName';

export interface EnrichmentResult {
  quantity: number | null;
  unit: string | null;
  name: string;
  category: string;
  sellUnit: string;
  packSize: number;
  grams: Record<string, number> | null;
}

/** Canonical key for a raw ingredient line: lowercase, trimmed, whitespace-collapsed. */
export function rawKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

let byRaw = new Map<string, EnrichmentResult>();
let byName = new Map<string, EnrichmentResult>();

/** Replace the in-memory index. Called by the store whenever its state changes. */
export function setEnrichmentIndex(byRawLine: Record<string, EnrichmentResult>): void {
  const nextRaw = new Map<string, EnrichmentResult>();
  const nextName = new Map<string, EnrichmentResult>();
  for (const [key, result] of Object.entries(byRawLine)) {
    nextRaw.set(key, result);
    const nameKey = normalizeName(result.name);
    if (nameKey) nextName.set(nameKey, result);
  }
  byRaw = nextRaw;
  byName = nextName;
}

export function getEnrichmentByName(name: string): EnrichmentResult | null {
  const key = normalizeName(name);
  if (!key) return null;
  return byName.get(key) ?? null;
}

export function getEnrichmentByRaw(raw: string): EnrichmentResult | null {
  if (!raw) return null;
  return byRaw.get(rawKey(raw)) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/enrichmentLookup.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/utils/enrichmentLookup.ts src/__tests__/enrichmentLookup.test.ts
git commit -m "feat: pure in-memory enrichment lookup index"
```

---

### Task 2: Persisted enrichment store + hydration wiring

**Files:**
- Modify: `src/store/storage.ts` (add key to `STORAGE_KEYS`)
- Create: `src/store/useIngredientEnrichmentStore.ts`
- Modify: `src/store/hydration.ts` (import + add to `stores` array)
- Test: `src/__tests__/useIngredientEnrichmentStore.test.ts`

**Interfaces:**
- Consumes: `EnrichmentResult`, `rawKey`, `setEnrichmentIndex` from `src/utils/enrichmentLookup.ts`; `zustandStorage`, `STORAGE_KEYS` from `src/store/storage.ts`.
- Produces: `useIngredientEnrichmentStore` with state:
  - `byRawLine: Record<string, EnrichmentResult>`
  - `pending: string[]`
  - `setResult(rawLine: string, result: EnrichmentResult): void` — stores under `rawKey(rawLine)`, removes it from `pending`.
  - `markPending(rawLine: string): void` — adds `rawKey(rawLine)` to `pending` (deduped).
  - `clearPending(rawLine: string): void` — removes `rawKey(rawLine)` from `pending`.

Jest for this store works because AsyncStorage is only touched on async persist; the store methods themselves are synchronous state updates. If the store import pulls AsyncStorage and fails under ts-jest/node, the test mocks it (Step 1 includes the mock).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/useIngredientEnrichmentStore.test.ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { useIngredientEnrichmentStore } from '../store/useIngredientEnrichmentStore';
import { getEnrichmentByName, EnrichmentResult } from '../utils/enrichmentLookup';

function result(over: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    quantity: 1, unit: 'each', name: 'sirloin steak', category: 'Protein',
    sellUnit: 'lb', packSize: 1, grams: null, ...over,
  };
}

describe('useIngredientEnrichmentStore', () => {
  beforeEach(() => {
    useIngredientEnrichmentStore.setState({ byRawLine: {}, pending: [] });
  });

  it('markPending dedupes and clearPending removes', () => {
    const s = useIngredientEnrichmentStore.getState();
    s.markPending('Sirloin Steaks');
    s.markPending('sirloin steaks'); // same rawKey
    expect(useIngredientEnrichmentStore.getState().pending).toEqual(['sirloin steaks']);
    useIngredientEnrichmentStore.getState().clearPending('sirloin steaks');
    expect(useIngredientEnrichmentStore.getState().pending).toEqual([]);
  });

  it('setResult stores by rawKey and drops the line from pending', () => {
    const s = useIngredientEnrichmentStore.getState();
    s.markPending('sirloin steaks');
    s.setResult('sirloin steaks', result());
    const state = useIngredientEnrichmentStore.getState();
    expect(state.pending).toEqual([]);
    expect(state.byRawLine['sirloin steaks']).toEqual(result());
  });

  it('mirrors byRawLine into the pure lookup index on setResult', () => {
    useIngredientEnrichmentStore.getState().setResult('sirloin steaks', result());
    expect(getEnrichmentByName('sirloin steak')?.category).toBe('Protein');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/useIngredientEnrichmentStore.test.ts`
Expected: FAIL — `Cannot find module '../store/useIngredientEnrichmentStore'`.

- [ ] **Step 3a: Add the storage key**

In `src/store/storage.ts`, add to the `STORAGE_KEYS` object (after the `favorites` line):

```ts
  favorites: 'mealprep/favorites/v1',
  ingredientEnrichment: 'mealprep/ingredientEnrichment/v1',
```

- [ ] **Step 3b: Create the store**

```ts
// src/store/useIngredientEnrichmentStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage, STORAGE_KEYS } from './storage';
import {
  EnrichmentResult,
  rawKey,
  setEnrichmentIndex,
} from '../utils/enrichmentLookup';

interface IngredientEnrichmentState {
  byRawLine: Record<string, EnrichmentResult>;
  pending: string[];
  setResult: (rawLine: string, result: EnrichmentResult) => void;
  markPending: (rawLine: string) => void;
  clearPending: (rawLine: string) => void;
}

export const useIngredientEnrichmentStore = create<IngredientEnrichmentState>()(
  persist(
    (set) => ({
      byRawLine: {},
      pending: [],
      setResult: (rawLine, result) => {
        const key = rawKey(rawLine);
        if (!key) return;
        set((s) => ({
          byRawLine: { ...s.byRawLine, [key]: result },
          pending: s.pending.filter((p) => p !== key),
        }));
      },
      markPending: (rawLine) => {
        const key = rawKey(rawLine);
        if (!key) return;
        set((s) => (s.pending.includes(key) ? s : { pending: [...s.pending, key] }));
      },
      clearPending: (rawLine) => {
        const key = rawKey(rawLine);
        set((s) => ({ pending: s.pending.filter((p) => p !== key) }));
      },
    }),
    {
      name: STORAGE_KEYS.ingredientEnrichment,
      storage: zustandStorage,
      // Mirror persisted results into the pure lookup index once rehydrated.
      onRehydrateStorage: () => (state) => {
        if (state) setEnrichmentIndex(state.byRawLine);
      },
    }
  )
);

// Keep the pure lookup index in sync with every subsequent state change.
useIngredientEnrichmentStore.subscribe((state) => setEnrichmentIndex(state.byRawLine));
```

- [ ] **Step 3c: Wire into hydration**

In `src/store/hydration.ts`, add the import after the `useFavoritesStore` import:

```ts
import { useFavoritesStore } from './useFavoritesStore';
import { useIngredientEnrichmentStore } from './useIngredientEnrichmentStore';
```

And add it to the `stores` array (append before the closing bracket):

```ts
const stores = [useRecipeStore, useMealPlanStore, useMealScheduleStore, useMealDispositionStore, usePantryStore, useManualItemStore, useDismissedItemStore, useSettingsStore, usePriceOverrideStore, useFavoritesStore, useIngredientEnrichmentStore];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/useIngredientEnrichmentStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green (including existing suites).
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/store/storage.ts src/store/useIngredientEnrichmentStore.ts src/store/hydration.ts src/__tests__/useIngredientEnrichmentStore.test.ts
git commit -m "feat: persisted ingredient-enrichment store mirrored to lookup index"
```

---

### Task 3: Response validation (`parseEnrichmentResponse`)

**Files:**
- Create: `src/utils/enrichmentResponse.ts`
- Test: `src/__tests__/enrichmentResponse.test.ts`

**Interfaces:**
- Consumes: `EnrichmentResult` from `src/utils/enrichmentLookup.ts`; `categoryKeywords.json`.
- Produces:
  - `KNOWN_CATEGORIES: string[]` — unique `Object.values(categoryKeywords)` plus `'Other'`.
  - `parseEnrichmentResponse(raw: unknown): EnrichmentResult | null` — validates a model JSON object; returns `null` for anything invalid or `confidence === 'low'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/enrichmentResponse.test.ts
import { parseEnrichmentResponse, KNOWN_CATEGORIES } from '../utils/enrichmentResponse';

const valid = {
  quantity: 2, unit: 'each', name: 'sirloin steak',
  category: 'Protein', sellUnit: 'lb', packSize: 1,
  grams: { tbsp: 15 }, confidence: 'high',
};

describe('parseEnrichmentResponse', () => {
  it('accepts a well-formed high-confidence response', () => {
    const r = parseEnrichmentResponse(valid);
    expect(r).not.toBeNull();
    expect(r).toEqual({
      quantity: 2, unit: 'each', name: 'sirloin steak',
      category: 'Protein', sellUnit: 'lb', packSize: 1, grams: { tbsp: 15 },
    });
  });

  it('exposes the app category set including Other', () => {
    expect(KNOWN_CATEGORIES).toContain('Protein');
    expect(KNOWN_CATEGORIES).toContain('Produce');
    expect(KNOWN_CATEGORIES).toContain('Other');
  });

  it('rejects an unknown category', () => {
    expect(parseEnrichmentResponse({ ...valid, category: 'Meat' })).toBeNull();
  });

  it('rejects a non-positive packSize', () => {
    expect(parseEnrichmentResponse({ ...valid, packSize: 0 })).toBeNull();
    expect(parseEnrichmentResponse({ ...valid, packSize: -1 })).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(parseEnrichmentResponse({ ...valid, name: '  ' })).toBeNull();
  });

  it('discards low-confidence responses', () => {
    expect(parseEnrichmentResponse({ ...valid, confidence: 'low' })).toBeNull();
  });

  it('rejects non-object / null input', () => {
    expect(parseEnrichmentResponse(null)).toBeNull();
    expect(parseEnrichmentResponse('nope')).toBeNull();
    expect(parseEnrichmentResponse(42)).toBeNull();
  });

  it('normalizes null/absent quantity, unit, and grams', () => {
    const r = parseEnrichmentResponse({
      name: 'salt', category: 'Spices', sellUnit: 'each', packSize: 1, confidence: 'high',
    });
    expect(r).toEqual({
      quantity: null, unit: null, name: 'salt',
      category: 'Spices', sellUnit: 'each', packSize: 1, grams: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/enrichmentResponse.test.ts`
Expected: FAIL — `Cannot find module '../utils/enrichmentResponse'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/enrichmentResponse.ts
import categoryKeywords from '../data/categoryKeywords.json';
import { EnrichmentResult } from './enrichmentLookup';

export const KNOWN_CATEGORIES: string[] = Array.from(
  new Set([...Object.values(categoryKeywords as Record<string, string>), 'Other'])
);

const KNOWN = new Set(KNOWN_CATEGORIES);

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function gramsOrNull(v: unknown): Record<string, number> | null {
  if (typeof v !== 'object' || v === null) return null;
  const out: Record<string, number> = {};
  for (const [unit, g] of Object.entries(v as Record<string, unknown>)) {
    if (typeof g === 'number' && Number.isFinite(g) && g > 0) out[unit] = g;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate a raw model response object. Returns a clean EnrichmentResult, or null when
 * the response is malformed, uses an unknown category, or is self-flagged low-confidence.
 */
export function parseEnrichmentResponse(raw: unknown): EnrichmentResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.confidence === 'low') return null;

  const name = strOrNull(o.name);
  if (!name) return null;

  const category = typeof o.category === 'string' ? o.category : '';
  if (!KNOWN.has(category)) return null;

  const sellUnit = strOrNull(o.sellUnit);
  if (!sellUnit) return null;

  const packSize = numOrNull(o.packSize);
  if (packSize === null || packSize <= 0) return null;

  return {
    quantity: numOrNull(o.quantity),
    unit: strOrNull(o.unit),
    name,
    category,
    sellUnit,
    packSize,
    grams: gramsOrNull(o.grams),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/enrichmentResponse.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/utils/enrichmentResponse.ts src/__tests__/enrichmentResponse.test.ts
git commit -m "feat: validate + normalize LLM enrichment responses"
```

---

### Task 4: `categorize()` prefers enrichment

**Files:**
- Modify: `src/utils/categorizer.ts`
- Test: `src/__tests__/categorizer.test.ts` (create if absent)

**Interfaces:**
- Consumes: `getEnrichmentByName` from `src/utils/enrichmentLookup.ts`.
- Produces: unchanged `categorize(ingredientName: string): string` signature.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/categorizer.test.ts
import { categorize } from '../utils/categorizer';
import { setEnrichmentIndex, rawKey, EnrichmentResult } from '../utils/enrichmentLookup';

function enrich(name: string, category: string): EnrichmentResult {
  return { quantity: 1, unit: 'each', name, category, sellUnit: 'each', packSize: 1, grams: null };
}

describe('categorize', () => {
  beforeEach(() => setEnrichmentIndex({}));

  it('falls back to keyword match when no enrichment exists', () => {
    expect(categorize('chicken breast')).toBe('Protein');
    expect(categorize('sirloin steak')).toBe('Other'); // no keyword today
  });

  it('prefers an enrichment result over the keyword scan', () => {
    setEnrichmentIndex({ [rawKey('sirloin steaks')]: enrich('sirloin steak', 'Protein') });
    expect(categorize('sirloin steaks')).toBe('Protein');
  });

  it('enrichment can override an existing keyword category', () => {
    setEnrichmentIndex({ [rawKey('x')]: enrich('chicken broth', 'Protein') });
    // keyword map says Pantry; enrichment wins
    expect(categorize('chicken broth')).toBe('Protein');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/categorizer.test.ts`
Expected: FAIL — the "prefers an enrichment result" test fails (`sirloin steaks` returns `'Other'`).

- [ ] **Step 3: Modify `categorize`**

In `src/utils/categorizer.ts`, add the import and the pre-check:

```ts
import categoryKeywords from '../data/categoryKeywords.json';
import { normalizeName } from './normalizeName';
import { getEnrichmentByName } from './enrichmentLookup';

const SORTED_KEYWORDS: Array<[string, string]> = Object.entries(
  categoryKeywords as Record<string, string>
)
  .map(([k, v]) => [normalizeName(k), v] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

export function categorize(ingredientName: string): string {
  const enriched = getEnrichmentByName(ingredientName);
  if (enriched) return enriched.category;

  const name = normalizeName(ingredientName);
  for (const [keyword, category] of SORTED_KEYWORDS) {
    if (name.includes(keyword)) return category;
  }
  return 'Other';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/categorizer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green (existing aggregator/manual tests unaffected — empty index).
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/utils/categorizer.ts src/__tests__/categorizer.test.ts
git commit -m "feat: categorize() prefers cached LLM enrichment"
```

---

### Task 5: `getProfile()` prefers enrichment

**Files:**
- Modify: `src/utils/purchaseProfile.ts`
- Test: `src/__tests__/purchaseProfile.test.ts` (create if absent)

**Interfaces:**
- Consumes: `getEnrichmentByName` from `src/utils/enrichmentLookup.ts`.
- Produces: unchanged `getProfile(name: string): PurchaseProfile | null` signature.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/purchaseProfile.test.ts
import { getProfile, convertMeasure } from '../utils/purchaseProfile';
import { setEnrichmentIndex, rawKey, EnrichmentResult } from '../utils/enrichmentLookup';

function enrich(over: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    quantity: 1, unit: 'each', name: 'bell pepper', category: 'Produce',
    sellUnit: 'each', packSize: 1, grams: { tbsp: 9 }, ...over,
  };
}

describe('getProfile', () => {
  beforeEach(() => setEnrichmentIndex({}));

  it('falls back to price-derived default when no enrichment exists', () => {
    // chicken breast is priced per lb in priceDatabase.json
    expect(getProfile('chicken breast')).toEqual({ sellUnit: 'lb', packSize: 1 });
  });

  it('prefers an enrichment profile with its grams bridge', () => {
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({}) });
    expect(getProfile('bell pepper')).toEqual({ sellUnit: 'each', packSize: 1, grams: { tbsp: 9 } });
  });

  it('enriched grams bridge lets a volume unit convert to a count sell unit', () => {
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({}) });
    const profile = getProfile('bell pepper');
    // one bell pepper ~ 120g; grams table says 9g per tbsp => ~13.3 tbsp per pepper.
    // Here we only assert the bridge is usable (returns a finite number, not null).
    const asEach = convertMeasure(9, 'tbsp', 'each', profile);
    expect(asEach).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/purchaseProfile.test.ts`
Expected: FAIL — the "prefers an enrichment profile" test fails (falls back to price default `{sellUnit:'each',packSize:1}` with no grams, or null if no price).

- [ ] **Step 3: Modify `getProfile`**

In `src/utils/purchaseProfile.ts`, add the import at the top:

```ts
import profilesJson from '../data/purchaseProfiles.json';
import { convert, getFamily } from './unitConversion';
import { normalizeName } from './normalizeName';
import { findPrice } from './priceLookup';
import { getEnrichmentByName } from './enrichmentLookup';
```

Then add the enrichment pre-check as the first lines of `getProfile` (before the `const normalized = normalizeName(name);` line):

```ts
export function getProfile(name: string): PurchaseProfile | null {
  const enriched = getEnrichmentByName(name);
  if (enriched) {
    return enriched.grams
      ? { sellUnit: enriched.sellUnit, packSize: enriched.packSize, grams: enriched.grams }
      : { sellUnit: enriched.sellUnit, packSize: enriched.packSize };
  }

  const normalized = normalizeName(name);
  if (!normalized) return null;

  const exact = ENTRIES.find((e) => e.normalized === normalized);
  if (exact) return exact.profile;

  const price = findPrice(name);
  if (price) return { sellUnit: price.unit, packSize: 1 };

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/purchaseProfile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green.
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/utils/purchaseProfile.ts src/__tests__/purchaseProfile.test.ts
git commit -m "feat: getProfile() prefers cached LLM purchase profile"
```

---

### Task 6: `aggregate()` applies enriched re-parse via `Ingredient.raw`

**Files:**
- Modify: `src/utils/ingredientAggregator.ts`
- Test: `src/__tests__/ingredientAggregator.test.ts` (add cases; keep existing ones passing)

**Interfaces:**
- Consumes: `getEnrichmentByRaw` from `src/utils/enrichmentLookup.ts`.
- Produces:
  - New exported helper `applyEnrichedParse(ing: Ingredient): Ingredient` — returns an enriched `{name, quantity, unit, raw}` when `getEnrichmentByRaw(ing.raw)` hits and supplies a usable quantity+unit; otherwise returns `ing` unchanged.
  - `aggregate(plan, recipes)` and `mergeGroup(...)` signatures unchanged.

Rationale: recipe ingredients are stored pre-parsed but retain their original `raw` line. Substituting the enriched base *before* `scaleIngredients` lets the LLM's corrected qty/unit/name flow through the whole pipeline (scaling multiplies the enriched base quantity), with zero change to how recipes are stored.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/ingredientAggregator.test.ts` (imports at top of file — merge with existing imports):

```ts
import { aggregate, applyEnrichedParse } from '../utils/ingredientAggregator';
import { setEnrichmentIndex, rawKey, EnrichmentResult } from '../utils/enrichmentLookup';
import { Ingredient, MealPlanEntry, Recipe } from '../types';

function enrich(over: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    quantity: 1, unit: 'each', name: 'bell pepper', category: 'Produce',
    sellUnit: 'each', packSize: 1, grams: null, ...over,
  };
}

describe('applyEnrichedParse', () => {
  beforeEach(() => setEnrichmentIndex({}));

  it('returns the ingredient unchanged when no enrichment matches', () => {
    const ing: Ingredient = { name: 'bell pepper', quantity: 2, unit: 'tbsp', raw: '2 tbsp diced bell pepper' };
    expect(applyEnrichedParse(ing)).toEqual(ing);
  });

  it('returns the ingredient unchanged when it has no raw line', () => {
    const ing: Ingredient = { name: 'bell pepper', quantity: 2, unit: 'tbsp' };
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({ quantity: 1, unit: 'each' }) });
    expect(applyEnrichedParse(ing)).toEqual(ing);
  });

  it('substitutes enriched name/quantity/unit when the raw line matches', () => {
    const ing: Ingredient = { name: 'diced bell pepper', quantity: 2, unit: 'tbsp', raw: '2 tbsp diced bell pepper' };
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({ name: 'bell pepper', quantity: 1, unit: 'each' }) });
    expect(applyEnrichedParse(ing)).toEqual({
      name: 'bell pepper', quantity: 1, unit: 'each', raw: '2 tbsp diced bell pepper',
    });
  });

  it('ignores an enrichment with null quantity/unit (keeps the regex parse)', () => {
    const ing: Ingredient = { name: 'diced bell pepper', quantity: 2, unit: 'tbsp', raw: '2 tbsp diced bell pepper' };
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({ name: 'bell pepper', quantity: null, unit: null }) });
    // name may still be corrected, but quantity/unit fall back to the original
    const out = applyEnrichedParse(ing);
    expect(out.quantity).toBe(2);
    expect(out.unit).toBe('tbsp');
  });
});

describe('aggregate with enrichment', () => {
  beforeEach(() => setEnrichmentIndex({}));

  it('reflects the enriched name in the grocery item', () => {
    const recipe: Recipe = {
      id: 'r1', title: 'Test', servings: 1,
      ingredients: [{ name: 'diced bell pepper', quantity: 2, unit: 'tbsp', raw: '2 tbsp diced bell pepper' }],
    } as Recipe;
    const plan: MealPlanEntry[] = [{ recipeId: 'r1', desiredServings: 1 } as MealPlanEntry];
    setEnrichmentIndex({ [rawKey('2 tbsp diced bell pepper')]: enrich({ name: 'bell pepper', quantity: 1, unit: 'each' }) });
    const items = aggregate(plan, [recipe]);
    expect(items.some((i) => i.name === 'bell pepper')).toBe(true);
  });
});
```

Note: match the `Recipe` / `MealPlanEntry` shape used by the existing tests in this file — if they use a factory helper, reuse it and only override `ingredients`/`raw`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/ingredientAggregator.test.ts`
Expected: FAIL — `applyEnrichedParse` is not exported.

- [ ] **Step 3: Modify `aggregate` and add the helper**

In `src/utils/ingredientAggregator.ts`, add the import:

```ts
import { getEnrichmentByRaw } from './enrichmentLookup';
```

Add the exported helper near the top (after imports):

```ts
/**
 * If a cached LLM enrichment exists for this ingredient's original raw line AND supplies a
 * usable quantity+unit, substitute the enriched name/quantity/unit (the enriched quantity is
 * the UNSCALED base — scaling is applied afterward by scaleIngredients). Otherwise return the
 * regex-parsed ingredient unchanged.
 */
export function applyEnrichedParse(ing: Ingredient): Ingredient {
  if (!ing.raw) return ing;
  const e = getEnrichmentByRaw(ing.raw);
  if (!e) return ing;
  const name = e.name.trim() || ing.name;
  if (typeof e.quantity === 'number' && Number.isFinite(e.quantity) && e.quantity > 0 && e.unit) {
    return { name, quantity: e.quantity, unit: e.unit, raw: ing.raw };
  }
  // No usable qty/unit: keep the regex parse but still accept the corrected name.
  return { ...ing, name };
}
```

Then in `aggregate`, apply it before scaling. Change the loop body:

```ts
  for (const entry of plan) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const ratio = entry.desiredServings / Math.max(1, recipe.servings);
    const effective = recipe.ingredients.map(applyEnrichedParse);
    const scaled = scaleIngredients(effective, ratio);
    for (const ing of scaled) {
      const purchasable = toPurchasableName(ing.name);
      const normalized = normalizeName(purchasable);
      if (!normalized) continue;
      all.push({ normalized, display: purchasable, ing });
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/ingredientAggregator.test.ts`
Expected: PASS (existing + new cases).

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green.
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/utils/ingredientAggregator.ts src/__tests__/ingredientAggregator.test.ts
git commit -m "feat: aggregate() applies enriched re-parse via Ingredient.raw"
```

---

### Task 7: Settings fields for Ollama

**Files:**
- Modify: `src/types/index.ts` (extend `UserSettings`)
- Modify: `src/store/useSettingsStore.ts` (defaults, setters, merge backfill)
- Test: `src/__tests__/settingsOllama.test.ts`

**Interfaces:**
- Produces on `UserSettings`: `ollamaEnabled: boolean`, `ollamaEndpoint: string`, `ollamaModel: string`.
- Produces on the store: `setOllamaEnabled(v: boolean)`, `setOllamaEndpoint(url: string)`, `setOllamaModel(model: string)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/settingsOllama.test.ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { useSettingsStore } from '../store/useSettingsStore';

describe('settings ollama fields', () => {
  beforeEach(() => useSettingsStore.getState().resetSettings());

  it('defaults to disabled with an empty endpoint and a default model', () => {
    const s = useSettingsStore.getState().settings;
    expect(s.ollamaEnabled).toBe(false);
    expect(s.ollamaEndpoint).toBe('');
    expect(s.ollamaModel).toBe('qwen2.5:7b-instruct');
  });

  it('setters update each field and trim the endpoint', () => {
    const st = useSettingsStore.getState();
    st.setOllamaEnabled(true);
    st.setOllamaEndpoint('  http://home:11434  ');
    st.setOllamaModel('llama3.1:8b-instruct');
    const s = useSettingsStore.getState().settings;
    expect(s.ollamaEnabled).toBe(true);
    expect(s.ollamaEndpoint).toBe('http://home:11434');
    expect(s.ollamaModel).toBe('llama3.1:8b-instruct');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/settingsOllama.test.ts`
Expected: FAIL — `ollamaEnabled` is undefined / setters don't exist.

- [ ] **Step 3a: Extend the type**

In `src/types/index.ts`, add three fields to the `UserSettings` interface (after `cookingEasePreference` or wherever the block ends):

```ts
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  cookingFrequency: CookingFrequency;
  cookingEasePreference: number;
  ollamaEnabled: boolean;
  ollamaEndpoint: string;
  ollamaModel: string;
```

(Insert the three `ollama*` lines at the end of the interface; keep existing fields.)

- [ ] **Step 3b: Update the store**

In `src/store/useSettingsStore.ts`:

Add to `DEFAULT_SETTINGS`:

```ts
  cookingFrequency: 'few_days',
  cookingEasePreference: 0.5,
  ollamaEnabled: false,
  ollamaEndpoint: '',
  ollamaModel: 'qwen2.5:7b-instruct',
```

Add to the `SettingsState` interface:

```ts
  setOllamaEnabled: (value: boolean) => void;
  setOllamaEndpoint: (url: string) => void;
  setOllamaModel: (model: string) => void;
```

Add the setter implementations (next to `setReduceVisualEffects`):

```ts
      setOllamaEnabled: (value) =>
        set((s) => ({ settings: { ...s.settings, ollamaEnabled: value } })),
      setOllamaEndpoint: (url) =>
        set((s) => ({ settings: { ...s.settings, ollamaEndpoint: url.trim() } })),
      setOllamaModel: (model) =>
        set((s) => ({ settings: { ...s.settings, ollamaModel: model.trim() } })),
```

Add backfill in the `merge` function's returned `settings` object (alongside the other `ps?.` defaults):

```ts
            ollamaEnabled: ps?.ollamaEnabled ?? false,
            ollamaEndpoint: typeof ps?.ollamaEndpoint === 'string' ? ps!.ollamaEndpoint : '',
            ollamaModel:
              typeof ps?.ollamaModel === 'string' && ps!.ollamaModel
                ? ps!.ollamaModel
                : 'qwen2.5:7b-instruct',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/settingsOllama.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green.
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/types/index.ts src/store/useSettingsStore.ts src/__tests__/settingsOllama.test.ts
git commit -m "feat: add Ollama enable/endpoint/model settings fields"
```

---

### Task 8: Ollama request builder (pure)

**Files:**
- Create: `src/lib/ollamaRequest.ts`
- Test: `src/__tests__/ollamaRequest.test.ts`

**Interfaces:**
- Consumes: `KNOWN_CATEGORIES` from `src/utils/enrichmentResponse.ts`.
- Produces: `buildEnrichmentRequest(rawLine: string, model: string): OllamaChatRequest` — returns the exact JSON body POSTed to `/api/chat`, including the structured-output `format` JSON schema constraining `category` to `KNOWN_CATEGORIES` and forcing `stream: false`.

Splitting the pure request body out means the schema/prompt is unit-tested even though the network call (Task 9) is not.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/ollamaRequest.test.ts
import { buildEnrichmentRequest } from '../lib/ollamaRequest';
import { KNOWN_CATEGORIES } from '../utils/enrichmentResponse';

describe('buildEnrichmentRequest', () => {
  const req = buildEnrichmentRequest('2 tbsp diced bell pepper', 'qwen2.5:7b-instruct');

  it('targets the given model with streaming disabled', () => {
    expect(req.model).toBe('qwen2.5:7b-instruct');
    expect(req.stream).toBe(false);
  });

  it('includes the raw line in a user message', () => {
    const userMsg = req.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('2 tbsp diced bell pepper');
  });

  it('constrains category to the known set via the format schema', () => {
    const cat = (req.format as any).properties.category;
    expect(cat.enum).toEqual(KNOWN_CATEGORIES);
  });

  it('requires the core fields in the schema', () => {
    expect((req.format as any).required).toEqual(
      expect.arrayContaining(['name', 'category', 'sellUnit', 'packSize', 'confidence'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/ollamaRequest.test.ts`
Expected: FAIL — `Cannot find module '../lib/ollamaRequest'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/ollamaRequest.ts
import { KNOWN_CATEGORIES } from '../utils/enrichmentResponse';

export interface OllamaChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  stream: false;
  messages: OllamaChatMessage[];
  format: Record<string, unknown>;
}

const SYSTEM_PROMPT = [
  'You convert a single raw recipe ingredient line into structured grocery-shopping data.',
  'Respond ONLY with a JSON object matching the schema.',
  'quantity/unit/name: what the line means (e.g. "2 tbsp diced bell pepper" -> name "bell pepper").',
  'category: the grocery aisle, chosen from the allowed list.',
  'sellUnit/packSize: how a US grocery store SELLS the item (e.g. bell pepper sold as "each", packSize 1;',
  'cheddar sold as a "block"). packSize is how many sellUnits come in one package (usually 1).',
  'grams: OPTIONAL map of {unit: gramsPerOneUnit} bridging recipe units to the sell unit',
  '(e.g. {"tbsp": 9, "each": 120} for a bell pepper). Include it whenever the recipe unit differs',
  'in kind from the sell unit (volume/count/weight), so quantities can convert. Use null if unsure.',
  'confidence: "high" only when you are confident; otherwise "low".',
].join(' ');

const FORMAT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    quantity: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'] },
    name: { type: 'string' },
    category: { type: 'string', enum: KNOWN_CATEGORIES },
    sellUnit: { type: 'string' },
    packSize: { type: 'number' },
    grams: { type: ['object', 'null'] },
    confidence: { type: 'string', enum: ['high', 'low'] },
  },
  required: ['name', 'category', 'sellUnit', 'packSize', 'confidence'],
};

/** Build the exact request body for Ollama's POST /api/chat with structured output. */
export function buildEnrichmentRequest(rawLine: string, model: string): OllamaChatRequest {
  return {
    model,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Ingredient line: "${rawLine}"` },
    ],
    format: FORMAT_SCHEMA,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/ollamaRequest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/lib/ollamaRequest.ts src/__tests__/ollamaRequest.test.ts
git commit -m "feat: build Ollama structured-output enrichment request"
```

---

### Task 9: Ollama network client (run-verified)

**Files:**
- Create: `src/lib/ollamaClient.ts`

**Interfaces:**
- Consumes: `buildEnrichmentRequest` (Task 8), `parseEnrichmentResponse` (Task 3), `EnrichmentResult` (Task 1).
- Produces: `callOllamaEnrichment(rawLine: string, opts: { endpoint: string; model: string; timeoutMs?: number }): Promise<EnrichmentResult | null>` — POSTs to `<endpoint>/api/chat`, parses the returned message content JSON, validates it, and returns the result or `null`. Never throws.

No Jest test (network + fetch, per project norm that screens/IO are verified by running). Correctness is verified against a real Ollama in Task 12's end-to-end run.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/ollamaClient.ts
import { buildEnrichmentRequest } from './ollamaRequest';
import { parseEnrichmentResponse } from '../utils/enrichmentResponse';
import { EnrichmentResult } from '../utils/enrichmentLookup';

interface OllamaChatResponse {
  message?: { content?: string };
}

/**
 * Call a self-hosted Ollama to enrich one raw ingredient line. Fails open: any network error,
 * timeout, bad status, or unparseable/low-confidence body yields null (never throws).
 */
export async function callOllamaEnrichment(
  rawLine: string,
  opts: { endpoint: string; model: string; timeoutMs?: number }
): Promise<EnrichmentResult | null> {
  const endpoint = opts.endpoint.trim().replace(/\/+$/, '');
  if (!endpoint || !rawLine.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEnrichmentRequest(rawLine, opts.model)),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content;
    if (!content) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    return parseEnrichmentResponse(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ollamaClient.ts
git commit -m "feat: Ollama enrichment network client (fail-open, 5s timeout)"
```

---

### Task 10: Enrichment queue orchestration (run-verified)

**Files:**
- Create: `src/lib/enrichmentQueue.ts`

**Interfaces:**
- Consumes: `useSettingsStore`, `useIngredientEnrichmentStore`, `callOllamaEnrichment`, `rawKey`.
- Produces:
  - `enqueueEnrichment(rawLines: string[]): void` — fire-and-forget; for each line that is enabled, not already cached, and not already pending, marks it pending and calls Ollama, writing the result (or clearing pending on failure). Concurrency-limited so a big recipe doesn't fire 20 calls at once.
  - `retryPendingEnrichment(): void` — re-runs `enqueueEnrichment` over the current `pending` list (used on app foreground).

No Jest test (touches stores + network). Verified in Task 12.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/enrichmentQueue.ts
import { useSettingsStore } from '../store/useSettingsStore';
import { useIngredientEnrichmentStore } from '../store/useIngredientEnrichmentStore';
import { callOllamaEnrichment } from './ollamaClient';
import { rawKey } from '../utils/enrichmentLookup';

const MAX_CONCURRENT = 3;
let active = 0;
const queue: string[] = [];

function pump(): void {
  const { settings } = useSettingsStore.getState();
  if (!settings.ollamaEnabled || !settings.ollamaEndpoint) {
    queue.length = 0;
    return;
  }
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const rawLine = queue.shift() as string;
    active++;
    void runOne(rawLine).finally(() => {
      active--;
      pump();
    });
  }
}

async function runOne(rawLine: string): Promise<void> {
  const { settings } = useSettingsStore.getState();
  const store = useIngredientEnrichmentStore.getState();
  const result = await callOllamaEnrichment(rawLine, {
    endpoint: settings.ollamaEndpoint,
    model: settings.ollamaModel,
  });
  if (result) store.setResult(rawLine, result);
  else store.clearPending(rawLine);
}

/** Queue new raw ingredient lines for enrichment. Fire-and-forget; safe to call often. */
export function enqueueEnrichment(rawLines: string[]): void {
  const { settings } = useSettingsStore.getState();
  if (!settings.ollamaEnabled || !settings.ollamaEndpoint) return;
  const store = useIngredientEnrichmentStore.getState();
  for (const line of rawLines) {
    const key = rawKey(line);
    if (!key) continue;
    if (store.byRawLine[key]) continue;        // already enriched
    if (store.pending.includes(key)) continue; // already queued
    if (queue.includes(line)) continue;
    store.markPending(line);
    queue.push(line);
  }
  pump();
}

/** Re-attempt every line still marked pending (e.g. after the app returns to foreground). */
export function retryPendingEnrichment(): void {
  const { settings } = useSettingsStore.getState();
  if (!settings.ollamaEnabled || !settings.ollamaEndpoint) return;
  const { pending } = useIngredientEnrichmentStore.getState();
  for (const key of pending) {
    if (!queue.includes(key)) queue.push(key);
  }
  pump();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrichmentQueue.ts
git commit -m "feat: fire-and-forget enrichment queue with concurrency limit + retry"
```

---

### Task 11: Settings UI for Ollama enrichment (run-verified)

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `settings.ollamaEnabled/ollamaEndpoint/ollamaModel` and setters from `useSettingsStore`.
- Produces: a new "Local AI enrichment" section with a toggle (reusing `SettingsToggleRow`), plus an endpoint `Input` and a model `Input` shown when enabled.

- [ ] **Step 1: Add store selectors**

In `SettingsScreen()`, near the other `useSettingsStore` selectors, add:

```ts
  const setOllamaEnabled = useSettingsStore((s) => s.setOllamaEnabled);
  const setOllamaEndpoint = useSettingsStore((s) => s.setOllamaEndpoint);
  const setOllamaModel = useSettingsStore((s) => s.setOllamaModel);
```

Add local input state near the other `useState` calls:

```ts
  const [ollamaEndpoint, setOllamaEndpointLocal] = useState(settings.ollamaEndpoint);
  const [ollamaModel, setOllamaModelLocal] = useState(settings.ollamaModel);
```

- [ ] **Step 2: Add the section**

Insert this block just before the `<SectionHeader title="Appearance" />` block:

```tsx
      <SectionHeader title="Local AI enrichment" />
      <Surface variant="outlined" pad={0}>
        <SettingsToggleRow
          icon="robot-outline"
          title="Local AI enrichment"
          subtitle="Use a self-hosted Ollama model to categorize items and fix shopping quantities. Off by default; works offline via your deterministic rules when unreachable."
          value={settings.ollamaEnabled}
          onValueChange={(v) => {
            haptics.selection();
            setOllamaEnabled(v);
          }}
        />
      </Surface>
      {settings.ollamaEnabled ? (
        <Surface variant="outlined" pad={t.spacing.lg} style={{ marginTop: t.spacing.sm }}>
          <Text variant="caption" tone="secondary" style={{ marginBottom: t.spacing.sm }}>
            Ollama endpoint (e.g. your Tailscale address)
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://your-host:11434"
            value={ollamaEndpoint}
            onChangeText={setOllamaEndpointLocal}
            onBlur={() => setOllamaEndpoint(ollamaEndpoint)}
          />
          <Text variant="caption" tone="secondary" style={{ marginTop: t.spacing.md, marginBottom: t.spacing.sm }}>
            Model
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="qwen2.5:7b-instruct"
            value={ollamaModel}
            onChangeText={setOllamaModelLocal}
            onBlur={() => setOllamaModel(ollamaModel)}
          />
        </Surface>
      ) : null}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the app**

Run: `npx expo start` (press `i`, `a`, or `w`). Open **You → Local AI enrichment**.
Expected:
- Toggle is OFF by default.
- Turning it ON reveals the endpoint + model inputs.
- Typing an endpoint and blurring persists it (reopen Settings — value remains).

- [ ] **Step 5: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "feat: Settings UI for local AI enrichment (toggle, endpoint, model)"
```

---

### Task 12: Wire triggers + foreground retry (run-verified)

**Files:**
- Modify: `src/screens/GroceryListScreen.tsx` (enqueue on manual add)
- Modify: `src/screens/AddRecipeScreen.tsx` (enqueue on recipe save)
- Modify: `App.tsx` (retry pending on foreground)

**Interfaces:**
- Consumes: `enqueueEnrichment`, `retryPendingEnrichment` from `src/lib/enrichmentQueue.ts`.

- [ ] **Step 1: Enqueue on manual add (GroceryListScreen)**

In `src/screens/GroceryListScreen.tsx`, add the import:

```ts
import { enqueueEnrichment } from '../lib/enrichmentQueue';
```

In the `AddItemSheet` `onAdd` handler (around line 337), add the enqueue after `addManualItem`:

```tsx
        onAdd={(name, quantity, unit) => {
          addManualItem({ name, quantity, unit });
          enqueueEnrichment([name]);
        }}
```

(Keep any other logic already inside that handler; only add the `enqueueEnrichment` line.)

- [ ] **Step 2: Enqueue on recipe save (AddRecipeScreen)**

In `src/screens/AddRecipeScreen.tsx`, add the import:

```ts
import { enqueueEnrichment } from '../lib/enrichmentQueue';
```

In `handleSave` (line ~272), the parsed ingredient array is `cleaned` and the recipe is persisted via `addRecipe({...})` (line ~286) just before `navigation.goBack()`. Enqueue the raw lines immediately after `addRecipe(...)` and before `navigation.goBack()`:

```ts
    addRecipe({
      title: title.trim(),
      sourceUrl,
      servings: Math.max(1, servings),
      ingredients: cleaned,
      instructions: steps.length > 0 ? steps : undefined,
      nutritionPerServing: nutrition,
      imageUrl: sanitizeImageUrl(imageUrl.trim()),
    });
    enqueueEnrichment(cleaned.map((i) => i.raw ?? i.name));
    navigation.goBack();
```

This is the single save path for both manual-entry and URL-import recipes (URL import prefills the same form, which routes through `handleSave`), so one insertion covers both.

- [ ] **Step 3: Retry pending on foreground (App.tsx)**

In `App.tsx`, add an `AppState` listener that retries pending enrichment when the app becomes active, plus once on mount. Add imports:

```ts
import { AppState } from 'react-native';
import { retryPendingEnrichment } from './src/lib/enrichmentQueue';
```

Inside the `App` component body (after hydration is set up), add:

```tsx
  useEffect(() => {
    retryPendingEnrichment();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryPendingEnrichment();
    });
    return () => sub.remove();
  }, []);
```

(If `App.tsx` gates rendering on `useHydration()`, place this effect so it runs after mount regardless — a top-level `useEffect` in the component is fine; the queue no-ops when enrichment is disabled or nothing is pending.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: End-to-end verification against real Ollama**

Prereqs: On a home computer joined to Tailscale, run `ollama serve` and `ollama pull qwen2.5:7b-instruct`. Confirm `OLLAMA_HOST=0.0.0.0` so it accepts LAN/Tailscale connections. Get the machine's Tailscale address.

Run: `npx expo start`, open the app, go to **You → Local AI enrichment**, enable it, and enter `http://<tailscale-host>:11434`.

Verify:
1. **Categorization fix** — Add a manual grocery item "sirloin steaks". It first appears under its deterministic category (likely "Other"); within a few seconds it moves to **Protein**. (Section re-sorts on the next render.)
2. **Quantity fix** — Add a recipe whose ingredient line is "2 tbsp diced bell pepper", add it to the plan, open the grocery list. The bell pepper appears as a whole-count purchase (e.g. "1 each"), not tablespoons.
3. **Offline fallback** — Disable Tailscale (or stop Ollama). Add a new never-seen item. It appears immediately via the deterministic path and the UI never hangs. Re-enable Ollama, background/foreground the app → the pending item enriches.
4. **Persistence** — Fully restart the app. Previously-enriched "sirloin steak" is still Protein with no new network call (watch the Ollama server logs — no request for it).
5. **Disabled = unchanged** — Toggle enrichment OFF. Add a new item → no request hits the Ollama logs; behavior matches pre-feature.

- [ ] **Step 6: Full suite, typecheck, commit**

Run: `npm test` — Expected: all green.
Run: `npm run typecheck` — Expected: no errors.

```bash
git add src/screens/GroceryListScreen.tsx src/screens/AddRecipeScreen.tsx App.tsx
git commit -m "feat: trigger enrichment on add + retry pending on foreground"
```

---

## Notes for the implementer

- **Deferred index mirroring:** the pure `enrichmentLookup` index is populated only by the store (Task 2's `onRehydrateStorage` + `subscribe`). In unit tests you set it directly via `setEnrichmentIndex(...)`; in the app it stays in sync automatically. Never import the store from a `src/utils/` file.
- **Why `getProfile` enrichment matters most:** the "tablespoons of bell pepper" problem is fixed primarily by the enriched purchase profile (its `grams` bridge lets `roundToPurchasable` convert `tbsp → each`), which already runs in the live pipeline via `getProfile`. The `aggregate()` re-parse (Task 6) is a secondary correction for genuinely mis-parsed lines.
- **AsyncStorage mock in store tests:** store-touching tests (`useIngredientEnrichmentStore`, `settingsOllama`) include a `jest.mock('@react-native-async-storage/async-storage', ...)` at the top. If the existing suite already provides a global mock (check `jest` config / a setup file), you may drop the inline mock — but an explicit inline mock is safe either way.
- **Ollama `OLLAMA_HOST`:** the server must bind to `0.0.0.0` (not just `127.0.0.1`) to be reachable over Tailscale — call this out to the user during verification if connections are refused.
