# Local LLM Ingredient Enrichment — Design Spec

**Date:** 2026-07-02
**Status:** Approved

## Context

Three steps in the grocery pipeline are currently pure keyword/regex logic with curated static data, and all three have known gaps:

- **Parsing** (`ingredientParser.ts`) splits raw ingredient text into quantity/unit/name via tokenization — generally solid, but has no semantic understanding, so unusual phrasing can mis-split.
- **Categorization** (`categorizer.ts`) does a longest-keyword-first substring match against `categoryKeywords.json`. Terms missing from that list (e.g. `steak`, `sirloin`) fall through to `'Other'` — confirmed as the cause of "sirloin steaks" not landing in Meat/Protein, for both recipe-parsed *and* manually-typed items (both paths call the same `categorize()`).
- **Purchase quantity** (`purchaseProfile.ts` / `purchaseRounding.ts`) converts a recipe quantity into a "how many to buy" count via a `grams` bridge, but only for the ~35 ingredients with an explicit `purchaseProfiles.json` entry. Anything else defaults to `{sellUnit: price.unit, packSize: 1}` with no `grams` bridge — so e.g. "2 tbsp diced bell pepper" can't convert tbsp → each and passes through unrounded, which is the "tablespoons of bell pepper" problem.

All three are fundamentally curation problems: the deterministic logic is fine, it just needs more data than can practically be hand-maintained. This spec adds a self-hosted local LLM (Ollama, on the user's home computer) as an enrichment layer that fills these data gaps automatically, while leaving the deterministic pipeline as the immediate, always-available fallback.

## Goal

When a new (never-seen) raw ingredient line enters the app — via recipe parsing or manual entry — enrich it once via a local LLM call, cache the result forever, and have the existing pure pipeline functions (`categorize()`, `getProfile()`, and the parser's qty/unit/name split) prefer the cached enrichment over their static-data fallback. The deterministic logic never goes away; it's the day-one, offline-safe answer, and the LLM result silently supersedes it once available.

---

## Architecture

### Network: Tailscale, not a public tunnel

Ollama runs on the user's home computer. The phone reaches it via **Tailscale** (both devices joined to the same tailnet), giving Ollama a stable private address reachable from anywhere — home WiFi, cellular, or a store's WiFi — without exposing it to the public internet or depending on `expo start --tunnel` (which only tunnels the Metro bundler during development and has no bearing on runtime API calls).

### One call per new raw ingredient line

The app calls Ollama's `/api/chat` endpoint directly (no intermediate proxy server), using Ollama's structured-output mode (`format` set to a JSON schema) so the response is constrained JSON, not free text requiring separate parsing-out.

Request is keyed by the **normalized raw ingredient line** (e.g. `"2 tbsp diced bell pepper"`), not by ingredient identity — the model is asked to do the full job in one call: parse quantity/unit/name AND infer category AND infer purchase profile, since all three require the same underlying understanding of what the food item actually is.

```
{ quantity: number | null, unit: string | null, name: string,
  category: string, sellUnit: string, packSize: number,
  grams: Record<string, number> | null, confidence: "high" | "low" }
```

- `category` is constrained (via the JSON schema) to the app's existing category list, derived from the known values in `categoryKeywords.json` — the model cannot invent new sections.
- `grams` mirrors `PurchaseProfile['grams']` (`Record<unit, gramsPerUnit>`), letting the enrichment result plug directly into `convertMeasure()`'s existing bridge logic with no changes to `purchaseProfile.ts` itself.
- Recommended model: **Qwen2.5 7B Instruct** or **Llama 3.1 8B Instruct** via `ollama pull` — both handle constrained JSON output well and run reasonably on typical home hardware. The model name lives in one config value, swappable without other changes.
- Each request has a short timeout (~5s) so an unreachable/slow server never stalls the UI — same "fails open" posture as the existing `compute-nutrition` edge function.

### New store: `src/store/useIngredientEnrichmentStore.ts`

```ts
interface EnrichmentResult {
  quantity: number | null;
  unit: string | null;
  name: string;
  category: string;
  sellUnit: string;
  packSize: number;
  grams: Record<string, number> | null;
}

interface IngredientEnrichmentState {
  byRawLine: Record<string, EnrichmentResult>; // key: normalized raw line
  pending: string[];                            // raw lines queued for retry
  setResult: (rawLine: string, result: EnrichmentResult) => void;
  markPending: (rawLine: string) => void;
  clearPending: (rawLine: string) => void;
}
```

- Persisted via `zustandStorage` under a new `STORAGE_KEYS.ingredientEnrichment` (`src/store/storage.ts`)
- Wired into the `stores` array in `src/store/hydration.ts` (required per CLAUDE.md — any new persisted store that's skipped here silently blocks hydration)
- Architecturally the same shape as `usePriceOverrideStore` — an override layer the pipeline consults before its static-data fallback — except this one is populated automatically by the LLM instead of manually by the user
- A derived selector, `getEnrichmentByName(name)`, scans `byRawLine` for any cached entry whose `name` field normalizes to the given ingredient name, so category/purchase-profile lookups can hit the cache even when the *exact* raw line differs from what was originally enriched (e.g. a different recipe's phrasing for the same ingredient still benefits once any one phrasing has been enriched)

### Trigger & flow

1. A recipe is parsed (`AddRecipeScreen`) or a manual item is typed (`GroceryListScreen`'s `AddItemSheet`). The existing regex parser and `categorize()` run immediately and the result renders right away — **no latency or behavior change from today**.
2. If the raw line isn't in `byRawLine` and isn't already `pending`, it's marked pending and a background (non-blocking) call to Ollama fires.
3. On success: `parseEnrichmentResponse()` (new pure function, see below) validates the response; if valid and `confidence !== "low"`, `setResult()` writes it to the cache and clears it from `pending`. Since screens already recompute via `useMemo` over store state, the corrected category/purchase-unit appears on the next natural re-render — no manual invalidation needed.
4. On failure, timeout, or a rejected/low-confidence response: nothing is cached, the line stays on the deterministic path, and it's cleared from `pending` so it can be retried later rather than stuck forever.
5. Retries are opportunistic and capped per app session (e.g. re-attempt everything still absent from the cache once per app foreground, not on a tight loop) — avoids hammering a computer that's simply turned off.

### Pipeline integration points

- **`categorize(name)`** — before the keyword scan, check `getEnrichmentByName(name)`; use its `category` if present, else fall back to today's logic unchanged.
- **`getProfile(name)`** — before the `purchaseProfiles.json` exact-match, check `getEnrichmentByName(name)`; use its `{sellUnit, packSize, grams}` if present, else fall back to today's logic unchanged.
- **`parseIngredient(raw)`** callers — when a raw line has a cached `byRawLine` entry, prefer its `{quantity, unit, name}` over the regex parser's output; otherwise use the regex parser as today.

All three integration points are additive (an extra cache-check before existing logic), so the deterministic pipeline's current behavior and tests are unaffected when the cache is empty or enrichment is disabled.

### Response validation

A new pure function, `parseEnrichmentResponse()` in `src/utils/`, validates the raw model JSON before anything is cached:

- `category` must be one of the app's known categories (else reject)
- `packSize` must be a positive number (else reject)
- `name` must be non-empty (else reject)
- `confidence: "low"` responses are discarded rather than cached — a shaky guess doesn't get "cached forever"; it's simply not written, so the line stays deterministic and can be retried

This function is unit-tested like the rest of `src/utils/`, per the existing testing philosophy (network call itself isn't tested, only the parse/validate boundary) — mirrors how `ingredientParser.test.ts` and friends test pure transformation logic today.

### Settings

New section in the Settings screen:
- **"Local AI enrichment"** toggle, off by default (`useSettingsStore`)
- Text field for the Ollama Tailscale endpoint (e.g. `http://<tailscale-hostname>:11434`)
- When the toggle is off, the app behaves exactly as it does today — no enrichment calls fire, `byRawLine` lookups simply never populate

---

## Out of Scope

- Any proxy/intermediate server in front of Ollama — the app calls Ollama's REST API directly
- Syncing the enrichment cache to Supabase / across devices — it's local-only (AsyncStorage) for now; a second device re-enriches independently, which is harmless
- Automatic pruning/eviction of the cache — not needed at this app's realistic scale (thousands of unique lines at most, a few MB); worth revisiting only if the cache grows large enough that Zustand's full-store-reserialize-on-write becomes noticeably slow, at which point switching to `expo-sqlite` for this one store is the escape hatch
- Editing `categoryKeywords.json` to add `steak`/`sirloin` as an immediate patch — out of scope for *this* spec, but nothing stops doing it separately as a same-day mitigation while this system is built
- Retrofitting the ~88 bundled `mealCatalog.json` meals through the LLM — this spec covers new ingredient lines going forward; backfilling the catalog is a separate, later task if desired

---

## Testing

- `parseEnrichmentResponse()` — valid response accepted; missing/invalid `category`, non-positive `packSize`, empty `name`, and `confidence: "low"` all rejected
- `categorize()` — cached enrichment result takes precedence over keyword match; falls back to existing behavior when no cache entry exists (existing tests must continue passing unchanged)
- `getProfile()` — same precedence test against `purchaseProfiles.json` lookup
- `useIngredientEnrichmentStore` — `setResult`/`markPending`/`clearPending` and the `getEnrichmentByName` selector's name-normalization matching

## Verification

1. Set up Ollama + a pulled model on a home computer joined to Tailscale; enter its Tailscale address in Settings and enable "Local AI enrichment"
2. Add a recipe containing "2 tbsp diced bell pepper" — confirm it renders immediately (deterministic path), then confirm the grocery list quantity updates to a whole-bell-pepper count once enrichment completes
3. Manually add "sirloin steaks" from the grocery list screen — confirm it initially lands in "Other" (or wherever today's keyword match puts it), then re-categorizes into Meat/Protein once enrichment completes
4. Disable Tailscale / stop Ollama, add a new never-seen ingredient — confirm it still renders correctly via the deterministic path and never blocks the UI
5. Restart the app after a successful enrichment — confirm the cached result persists (no re-enrichment call for the same line)
6. Toggle "Local AI enrichment" off — confirm no enrichment calls fire and existing behavior is unchanged
7. Run `npm test` and `npm run typecheck` — no regressions
