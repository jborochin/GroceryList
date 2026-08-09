import Fuse from 'fuse.js';
import priceDatabase from '../data/priceDatabase.json';
import { getLivePrices } from '../lib/priceCatalogSync';
import { PriceEntry, PriceOverride } from '../types';
import { normalizeName } from './normalizeName';

type PriceDb = Record<string, PriceEntry>;
const DB = priceDatabase as PriceDb;

const DB_ENTRIES: Array<{ key: string; normalized: string; entry: PriceEntry }> = Object.entries(DB)
  .map(([k, v]) => ({ key: k, normalized: normalizeName(k), entry: v }));

const fuse = new Fuse(DB_ENTRIES, {
  keys: ['normalized'],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
});

/**
 * Resolve an ingredient name to a price entry:
 * overrides → live overlay → bundled exact → substring → fuzzy.
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

  // 4. Substring (bidirectional)
  const sub = DB_ENTRIES.find(
    (e) => normalized.includes(e.normalized) || e.normalized.includes(normalized)
  );
  if (sub) return sub.entry;

  // 5. Fuzzy
  const fuzzy = fuse.search(normalized);
  if (fuzzy.length > 0 && fuzzy[0].score !== undefined && fuzzy[0].score < 0.35) {
    return fuzzy[0].item.entry;
  }

  return null;
}
