import Fuse from 'fuse.js';
import priceDatabase from '../data/priceDatabase.json';
import { GroceryItem, PriceEntry, PriceOverride } from '../types';
import { convert } from './unitConversion';
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

export function estimatePriceForItem(
  item: GroceryItem,
  overrides: Record<string, PriceOverride> = {}
): GroceryItem {
  const priceEntry = findPrice(item.name, overrides);
  if (!priceEntry) {
    return {
      ...item,
      entries: item.entries.map((e) => ({ ...e, price: undefined, priceReason: 'no-match' })),
      estimatedPrice: undefined,
      hasPriceGap: true,
    };
  }

  let total = 0;
  let gap = false;
  const newEntries = item.entries.map((e) => {
    const converted = convert(e.quantity, e.unit, priceEntry.unit);
    if (converted === null) {
      gap = true;
      return { ...e, price: undefined, priceReason: 'unit-conflict' as const };
    }
    const price = converted * priceEntry.pricePerUnit;
    total += price;
    return { ...e, price };
  });

  return {
    ...item,
    entries: newEntries,
    estimatedPrice: gap ? total || undefined : total,
    hasPriceGap: gap,
  };
}

export function estimatePrices(
  items: GroceryItem[],
  overrides: Record<string, PriceOverride> = {}
): { items: GroceryItem[]; total: number; unestimatedCount: number } {
  let total = 0;
  let unestimatedCount = 0;
  const enriched = items.map((item) => {
    const priced = estimatePriceForItem(item, overrides);
    if (priced.estimatedPrice !== undefined) total += priced.estimatedPrice;
    if (priced.hasPriceGap && priced.estimatedPrice === undefined) unestimatedCount += 1;
    return priced;
  });
  return { items: enriched, total, unestimatedCount };
}
