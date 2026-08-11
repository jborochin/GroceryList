/**
 * Deno-side `convertMeasure`, for the resolve-prices function.
 *
 * The app's version lives in src/utils/purchaseProfile.ts, but that module reaches
 * findPrice — and therefore fuse.js and the bundled 349-key catalog — so it cannot cross
 * into an edge function. The conversion logic itself is small and family-scoped, so it is
 * reimplemented here over the SAME unitConversion table the app uses. That table is the
 * part that must not diverge, and it is imported rather than copied.
 *
 * Kept behaviorally identical to purchaseProfile.convertMeasure: plain convert() within a
 * family, then a grams bridge across families, null when neither lands. Any drift here
 * would publish a price in the wrong unit, which is the one thing the pipeline must never
 * do — see the unit invariant in supabase/schema.sql.
 */
import { convert, getFamily } from '../../../src/utils/unitConversion.ts';
import type { ResolveProfile } from '../../../scripts/lib/resolveIngredient.ts';

export function convertMeasure(
  qty: number,
  from: string,
  to: string,
  profile: ResolveProfile | null
): number | null {
  if (from === to) return qty;
  const direct = convert(qty, from, to);
  if (direct !== null) return direct;
  if (!profile) return null;

  const grams = toGrams(qty, from, profile);
  if (grams === null) return null;
  return fromGrams(grams, to, profile);
}

function toGrams(qty: number, unit: string, profile: ResolveProfile): number | null {
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

function fromGrams(grams: number, unit: string, profile: ResolveProfile): number | null {
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
