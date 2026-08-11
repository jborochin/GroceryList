import Fuse from 'fuse.js';
import priceDatabase from '../data/priceDatabase.json';
import { getLivePrices } from '../lib/priceCatalogSync';
import { PriceEntry, PriceOverride } from '../types';
import { normalizeName } from './normalizeName';

type PriceDb = Record<string, PriceEntry>;
const DB = priceDatabase as PriceDb;

const DB_ENTRIES: Array<{ key: string; normalized: string; entry: PriceEntry }> = Object.entries(DB)
  .map(([k, v]) => ({ key: k, normalized: normalizeName(k), entry: v }));

/**
 * Split into comparable word tokens.
 *
 * `normalizeName` lowercases and collapses whitespace but leaves punctuation alone, and
 * recipe ingredients routinely arrive as "sirloin steak, trimmed" — so splitting on
 * non-alphanumerics rather than on spaces is what keeps a trailing prep clause from
 * hiding the ingredient.
 */
function words(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Does `haystack` contain `needle` as a run of CONSECUTIVE WHOLE WORDS?
 *
 * Whole words, not raw characters: plain `String.includes` resolves "graham cracker" to
 * the `ham` row and "cornbread" to `corn`. That class of false hit multiplies as the
 * catalog grows, so containment is checked token-wise.
 */
function containsWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Substring resolution runs in two passes over these, and the sort order of each is the
 * whole point — see the ordering note on step 4 in `findPrice`. Tokens are precomputed
 * here so resolution never re-tokenizes the catalog.
 *
 * Ordering is by CHARACTER length, not word count: `beef steak` and `sirloin steak` are
 * both two words, but the shorter string is the generic one. The alphabetical tiebreak
 * keeps equal-length keys deterministic, so a row's position in priceDatabase.json can
 * never decide a resolution.
 */
const WORDED = DB_ENTRIES.map((e) => ({ ...e, words: words(e.normalized) }));
const byLength = (dir: 1 | -1) => (a: typeof WORDED[number], b: typeof WORDED[number]) =>
  dir * (a.normalized.length - b.normalized.length) || a.normalized.localeCompare(b.normalized);
const BY_LENGTH_DESC = [...WORDED].sort(byLength(-1));
const BY_LENGTH_ASC = [...WORDED].sort(byLength(1));

const fuse = new Fuse(DB_ENTRIES, {
  keys: ['normalized'],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
});

/**
 * Resolve an ingredient name to a price entry:
 * overrides → live overlay → bundled exact → substring (specific, then generic) → fuzzy.
 *
 * Shared by the price estimator and the purchase-profile system so both agree on which
 * catalog row a free-text ingredient maps to.
 *
 * The live overlay (src/lib/priceCatalogSync.ts) is refreshed weekly from a retail price
 * API. It is consulted on EXACT normalized match only — substring and fuzzy resolution stay
 * on the bundled database, so behavior for names the catalog doesn't know is unchanged, and
 * an ingredient with no live price simply falls through to its bundled estimate.
 */
export function findPrice(
  ingredientName: string,
  overrides: Record<string, PriceOverride> = {}
): PriceEntry | null {
  const normalized = normalizeName(ingredientName);
  if (!normalized) return null;

  // 1. Overrides first — a user's own price always wins.
  if (overrides[normalized]) {
    const o = overrides[normalized];
    return { pricePerUnit: o.pricePerUnit, unit: o.unit };
  }

  // 2. Live overlay, exact match only. Guaranteed to carry the same unit as the
  //    bundled row (validated on ingest), so downstream profile/rounding behavior
  //    is identical whether or not a refresh has landed.
  const live = getLivePrices();
  if (live && live[normalized]) return live[normalized];

  // 3. Exact normalized match
  const exact = DB_ENTRIES.find((e) => e.normalized === normalized);
  if (exact) return exact.entry;

  // 4. Substring, in two passes whose sort orders are deliberately opposite.
  //
  //    The containment is bidirectional, and the two directions want opposite winners.
  //    Resolving both with one sorted scan gets one of them wrong, which matters a great
  //    deal now that the catalog carries specific cuts alongside their generic parent
  //    ("ribeye steak" and "sirloin steak" next to "beef steak").

  const queryWords = words(normalized);

  // 4a. A catalog key sits inside the query -> the MOST SPECIFIC key wins, so
  //     "boneless ribeye steak" resolves to `ribeye steak` rather than `beef steak`.
  const contained = BY_LENGTH_DESC.find((e) => containsWords(queryWords, e.words));
  if (contained) return contained.entry;

  // 4b. The query sits inside a catalog key -> the MOST GENERIC key wins, so a bare
  //     "steak" resolves to `beef steak` rather than whichever cut happens to be longest.
  const containing = BY_LENGTH_ASC.find((e) => containsWords(e.words, queryWords));
  if (containing) return containing.entry;

  // 5. Fuzzy
  const fuzzy = fuse.search(normalized);
  if (fuzzy.length > 0 && fuzzy[0].score !== undefined && fuzzy[0].score < 0.35) {
    return fuzzy[0].item.entry;
  }

  return null;
}
