import profilesJson from '../data/purchaseProfiles.json';
import { convert, getFamily } from './unitConversion';
import { normalizeName } from './normalizeName';
import { findPrice } from './priceLookup';

/**
 * How a store sells an ingredient. `grams` gives the weight of ONE of a unit and is used
 * only to bridge unit families that `convert()` refuses (volume↔weight↔count) — weight units
 * reach grams universally, so only volume/count units ever need an entry here.
 */
export interface PurchaseProfile {
  sellUnit: string;
  packSize: number;
  grams?: Record<string, number>;
}

// Precompute normalized keys. Skip `_`-prefixed keys (JSON doc comments) and any non-object
// value so the doc string never resolves as a profile.
const ENTRIES: Array<{ normalized: string; profile: PurchaseProfile }> = Object.entries(
  profilesJson as Record<string, unknown>
)
  .filter(([k, v]) => !k.startsWith('_') && typeof v === 'object' && v !== null)
  .map(([k, v]) => ({ normalized: normalizeName(k), profile: v as PurchaseProfile }));

/**
 * Resolve an ingredient to its purchase profile. An explicit `purchaseProfiles.json` entry
 * (exact normalized match) wins; otherwise a default is derived from the price entry
 * (sell unit = price unit, pack size 1). Returns null only when the item has no price either.
 * Overrides are intentionally ignored — pack semantics don't change when a user edits a price.
 */
export function getProfile(name: string): PurchaseProfile | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const exact = ENTRIES.find((e) => e.normalized === normalized);
  if (exact) return exact.profile;

  const price = findPrice(name);
  if (price) return { sellUnit: price.unit, packSize: 1 };

  return null;
}

/**
 * Convert `qty` from one unit to another, bridging across unit families when a profile's
 * `grams` table allows it. Falls back to plain `convert()` within a family (no profile needed).
 * Returns null when the conversion can't be made (e.g. cross-family with no grams anchor).
 */
export function convertMeasure(
  qty: number,
  from: string,
  to: string,
  profile: PurchaseProfile | null
): number | null {
  if (from === to) return qty;
  const direct = convert(qty, from, to);
  if (direct !== null) return direct;
  if (!profile) return null;

  const grams = toGrams(qty, from, profile);
  if (grams === null) return null;
  return fromGrams(grams, to, profile);
}

// --- family bridge via grams ---

function toGrams(qty: number, unit: string, profile: PurchaseProfile): number | null {
  if (getFamily(unit) === 'weight') return convert(qty, unit, 'g'); // universal mass
  const g = profile.grams;
  if (!g) return null;
  if (g[unit] != null) return qty * g[unit];
  // A volume unit not listed can still reach grams through any listed volume anchor.
  if (getFamily(unit) === 'volume') {
    const anchor = volumeAnchor(g);
    if (anchor) {
      const inAnchor = convert(qty, unit, anchor);
      if (inAnchor !== null) return inAnchor * g[anchor];
    }
  }
  return null;
}

function fromGrams(grams: number, unit: string, profile: PurchaseProfile): number | null {
  if (getFamily(unit) === 'weight') return convert(grams, 'g', unit); // universal mass
  const g = profile.grams;
  if (!g) return null;
  if (g[unit] != null) return grams / g[unit];
  if (getFamily(unit) === 'volume') {
    const anchor = volumeAnchor(g);
    if (anchor) return convert(grams / g[anchor], anchor, unit);
  }
  return null;
}

function volumeAnchor(grams: Record<string, number>): string | null {
  for (const u of Object.keys(grams)) if (getFamily(u) === 'volume') return u;
  return null;
}
