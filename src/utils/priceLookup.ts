import Fuse from 'fuse.js';
import priceDatabase from '../data/priceDatabase.json';
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
 * Resolve an ingredient name to a price entry: overrides → exact → substring → fuzzy.
 * Shared by the price estimator and the purchase-profile system so both agree on which
 * catalog row a free-text ingredient maps to.
 */
export function findPrice(
  ingredientName: string,
  overrides: Record<string, PriceOverride> = {}
): PriceEntry | null {
  const normalized = normalizeName(ingredientName);
  if (!normalized) return null;

  // 1. Overrides first
  if (overrides[normalized]) {
    const o = overrides[normalized];
    return { pricePerUnit: o.pricePerUnit, unit: o.unit };
  }

  // 2. Exact normalized match
  const exact = DB_ENTRIES.find((e) => e.normalized === normalized);
  if (exact) return exact.entry;

  // 3. Substring (bidirectional)
  const sub = DB_ENTRIES.find(
    (e) => normalized.includes(e.normalized) || e.normalized.includes(normalized)
  );
  if (sub) return sub.entry;

  // 4. Fuzzy
  const fuzzy = fuse.search(normalized);
  if (fuzzy.length > 0 && fuzzy[0].score !== undefined && fuzzy[0].score < 0.35) {
    return fuzzy[0].item.entry;
  }

  return null;
}
