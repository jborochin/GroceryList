import priceDatabase from '../data/priceDatabase.json';
import purchaseProfiles from '../data/purchaseProfiles.json';
import { PriceEntry } from '../types';
import { categorize } from '../utils/categorizer';
import { hasUnitLabel } from '../utils/formatters';
import { normalizeName } from '../utils/normalizeName';
import { findPrice } from '../utils/priceLookup';
import { isKnownUnit } from '../utils/unitConversion';

/**
 * Structural invariants for priceDatabase.json.
 *
 * The catalog is growing from ~170 generic nouns toward several hundred specific ones
 * ("ribeye steak" and "filet mignon" rather than one "beef steak"), and it is hand-edited.
 * These are the mistakes that a new row can make which otherwise surface far from their
 * cause — a dropped row at seed time, an ingredient landing in the wrong grocery aisle,
 * a quantity rendering as a raw token — so they are checked here rather than discovered
 * in production.
 */

const DB = priceDatabase as Record<string, PriceEntry>;
const PROFILES = purchaseProfiles as Record<string, unknown>;
const KEYS = Object.keys(DB);

describe('priceDatabase.json consistency', () => {
  it('has no two keys that normalize to the same string', () => {
    // public.price_sources is keyed by the NORMALIZED name, so a collision means one of
    // the two rows silently loses its live pricing. buildPriceSourcesSeed.ts throws on
    // this, but only when someone runs the seed script — which is usually long after the
    // key was added. Catching it in `npm test` puts the failure next to the edit.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const key of KEYS) {
      const normalized = normalizeName(key);
      const previous = seen.get(normalized);
      if (previous !== undefined) collisions.push(`"${previous}" + "${key}" -> "${normalized}"`);
      seen.set(normalized, key);
    }
    expect(collisions).toEqual([]);
  });

  it('has no key that normalizes to an empty string', () => {
    expect(KEYS.filter((k) => normalizeName(k) === '')).toEqual([]);
  });

  it('gives every key a real category, never the "Other" fallback', () => {
    // "Other" sorts last as an unlabelled catch-all in GroceryListScreen, so an
    // uncategorized ingredient reads as a bug to the user. Fix by adding a keyword to
    // categoryKeywords.json, not by relaxing this.
    const uncategorized = KEYS.filter((k) => categorize(k) === 'Other');
    expect(uncategorized).toEqual([]);
  });

  it('prices every key in a unit the conversion table knows', () => {
    // An unknown unit can never convert, so every entry for that ingredient is flagged
    // `unit-conflict` and the item silently shows no price.
    const unknown = KEYS.filter((k) => !isKnownUnit(DB[k].unit));
    expect(unknown).toEqual([]);
  });

  it('prices every key in a unit that renders with a real label', () => {
    // formatUnit falls back to echoing the raw token, so a missing UNIT_LABELS entry
    // ships as "2 fl_oz" instead of "2 fl oz".
    const raw = KEYS.filter((k) => !hasUnitLabel(DB[k].unit));
    expect(raw).toEqual([]);
  });

  it('gives every key a positive, finite price', () => {
    const bad = KEYS.filter((k) => !Number.isFinite(DB[k].pricePerUnit) || DB[k].pricePerUnit <= 0);
    expect(bad).toEqual([]);
  });

  it('resolves every key to itself by exact match', () => {
    // Guards the resolution ladder: if a key stops resolving to its own entry, the
    // substring/fuzzy passes have started shadowing exact matches.
    const misresolved = KEYS.filter((k) => {
      const found = findPrice(k);
      return !found || found.pricePerUnit !== DB[k].pricePerUnit || found.unit !== DB[k].unit;
    });
    expect(misresolved).toEqual([]);
  });

  it('declares a sell unit the conversion table knows, for every explicit profile', () => {
    // A profile's sellUnit is what roundToPurchasable branches on. An unknown one can
    // never convert, so the item silently stops rounding to whole packs.
    const bad = Object.entries(PROFILES)
      .filter(([key]) => !key.startsWith('_'))
      .filter(([, v]) => typeof v === 'object' && v !== null)
      .filter(([, v]) => !isKnownUnit((v as { sellUnit: string }).sellUnit))
      .map(([key]) => key);
    expect(bad).toEqual([]);
  });
});

// NOTE: cross-family pricing coverage (a `head`-sold ingredient used by the cup needing a
// `grams` bridge) is deliberately NOT re-checked here. purchaseProfileCoverage.test.ts
// already enforces it for exactly the ingredients where it can bite — those the meal
// catalog actually uses. Asserting it across every price key instead would flag rows like
// `lemon` or `black bean` that no recipe measures cross-family, which is noise, not a bug.
