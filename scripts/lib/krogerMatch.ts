/**
 * Pure matching + validation helpers for the live price refresh.
 *
 * Retail catalogs are branded-SKU shaped ("Kroger® Grade A Large Eggs, 12 ct")
 * while the app prices generic ingredients in canonical units ("eggs", per
 * `each`). These helpers bridge that gap and, more importantly, decide when NOT
 * to trust a match — an unreviewed auto-match only publishes if it clears all
 * three gates below. Anything rejected falls through to the bundled
 * hand-estimate, which is the app's existing behavior, so a rejection is always
 * safe.
 *
 * Kept free of network and filesystem access so it can be unit-tested directly,
 * same as scripts/lib/blsPriceMapping.ts.
 */

/** Minimum scoreMatch() result an UNREVIEWED candidate must clear to publish. */
export const MIN_CONFIDENCE = 0.6;

/** Multiplier band a candidate price must sit within, relative to the bundled baseline. */
export const UNREVIEWED_BAND = { min: 0.25, max: 4 } as const;
/** Reviewed SKUs were vetted by a human; only catch catastrophes (a 100x unit slip). */
export const REVIEWED_BAND = { min: 0.1, max: 10 } as const;

// --- size parsing ----------------------------------------------------------

export interface ParsedSize {
  qty: number;
  unit: string; // a canonical unit from src/utils/unitConversion.ts UNIT_TABLE
}

/**
 * Retail size-string tokens → the app's canonical units. Only units that exist
 * in UNIT_TABLE may appear on the right-hand side, otherwise convert() will
 * reject the result downstream.
 */
const SIZE_UNIT_ALIASES: Record<string, string> = {
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  'fl oz': 'fl_oz',
  floz: 'fl_oz',
  'fluid ounce': 'fl_oz',
  'fluid ounces': 'fl_oz',
  ml: 'ml',
  milliliter: 'ml',
  l: 'l',
  liter: 'l',
  litre: 'l',
  gal: 'gallon',
  gallon: 'gallon',
  qt: 'quart',
  quart: 'quart',
  pt: 'pint',
  pint: 'pint',
  ct: 'each',
  count: 'each',
  ea: 'each',
  each: 'each',
};

/** Size strings we refuse to interpret — a wrong pack size silently scales the price. */
const AMBIGUOUS_SIZE = /\b(?:pack of|case|bulk|assorted|varies|approx)\b/;

/**
 * Parse a retail size string into a canonical quantity + unit.
 *
 * Handles the common shapes: "16 oz", "1 lb", "12 ct", "64 fl oz", "0.5 gal",
 * and multipacks written as "6 x 12 oz" (→ 72 fl_oz-equivalent of that unit).
 * "dozen" expands to 12 each. Returns null for anything it can't pin down
 * exactly, which makes the caller skip the SKU rather than guess.
 */
export function parseSize(size: string | null | undefined): ParsedSize | null {
  if (!size) return null;

  const s = size
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || AMBIGUOUS_SIZE.test(s)) return null;

  // "1 dozen" / "dozen" — a count shorthand no numeric+unit rule would catch.
  const dozen = s.match(/^(?:([\d.]+)\s*)?dozen$/);
  if (dozen) {
    const packs = dozen[1] ? Number.parseFloat(dozen[1]) : 1;
    if (!Number.isFinite(packs) || packs <= 0) return null;
    return { qty: packs * 12, unit: 'each' };
  }

  // A bare unit with no number ("each") means one of them.
  const bare = SIZE_UNIT_ALIASES[s];
  if (bare) return { qty: 1, unit: bare };

  // Optional "N x " multipack prefix, then a number, then a unit phrase.
  const m = s.match(/^(?:([\d.]+)\s*(?:x|ct|count)?\s*[x×]\s*)?([\d.]+)\s*([a-z]+(?:\s+[a-z]+)*)$/);
  if (!m) return null;

  const multiplier = m[1] ? Number.parseFloat(m[1]) : 1;
  const amount = Number.parseFloat(m[2]);
  const unit = resolveUnitPhrase(m[3]);

  if (!unit) return null;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { qty: multiplier * amount, unit };
}

/**
 * Resolve the unit out of a size string's trailing phrase, tolerating packaging
 * noise after it ("5 lb bag", "16 oz can"). Tries the two-word form first so
 * "fl oz" wins over a bare "fl", then falls back to the single leading word.
 */
function resolveUnitPhrase(phrase: string): string | null {
  const tokens = phrase.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length >= 2) {
    const two = SIZE_UNIT_ALIASES[`${tokens[0]} ${tokens[1]}`];
    if (two) return two;
  }
  return SIZE_UNIT_ALIASES[tokens[0]] ?? null;
}

// --- description matching --------------------------------------------------

/**
 * Tokens that mean the SKU is not the ingredient we asked for, even when the
 * words line up. A term is only disqualifying when it does NOT appear in the
 * search term itself — otherwise searching for "cat food" style keys (or any
 * future key containing one of these words) would reject its own best match.
 */
const TRAP_TOKENS = [
  'dog',
  'cat',
  'puppy',
  'kitten',
  'pet',
  'candle',
  'soap',
  'shampoo',
  'detergent',
  'lotion',
  'supplement',
  'vitamin',
  'flavored',
  'flavoured',
  'scented',
  'toy',
];

const WORD_SPLIT = /[^a-z0-9]+/;

function tokenize(value: string): string[] {
  return value.toLowerCase().split(WORD_SPLIT).filter(Boolean);
}

/**
 * Score how well a SKU description matches the ingredient we searched for, 0..1.
 *
 * Two hard requirements before any score is given: no trap token, and the
 * search term's HEAD NOUN (its last word — "chicken breast" → "breast",
 * "cheddar cheese" → "cheese") must appear in the description. That head-noun
 * rule is what stops "chicken broth" from matching a search for "chicken".
 * The score itself is the fraction of search tokens present, so a fully
 * matched multi-word term scores 1.
 */
export function scoreMatch(searchTerm: string, description: string | null | undefined): number {
  if (!description) return 0;

  const termTokens = tokenize(searchTerm);
  const descTokens = tokenize(description);
  if (termTokens.length === 0 || descTokens.length === 0) return 0;

  const descSet = new Set(descTokens);
  const termSet = new Set(termTokens);

  for (const trap of TRAP_TOKENS) {
    if (descSet.has(trap) && !termSet.has(trap)) return 0;
  }

  const headNoun = termTokens[termTokens.length - 1];
  if (!descSet.has(headNoun)) return 0;

  const matched = termTokens.filter((t) => descSet.has(t)).length;
  return matched / termTokens.length;
}

// --- price sanity ----------------------------------------------------------

/**
 * Is a candidate price plausible next to the bundled hand-estimate?
 *
 * This is the last line of defense against a size misparse or a wrong SKU — a
 * per-pound price that comes back 50x the baseline is a unit slip, not a price
 * change. Reviewed mappings get a much wider band because a human already
 * confirmed the SKU; the band there only exists to catch outright corruption.
 */
export function sanityBand(
  candidatePricePerUnit: number,
  baselinePricePerUnit: number,
  reviewed: boolean
): boolean {
  if (!Number.isFinite(candidatePricePerUnit) || candidatePricePerUnit <= 0) return false;
  if (!Number.isFinite(baselinePricePerUnit) || baselinePricePerUnit <= 0) return false;

  const band = reviewed ? REVIEWED_BAND : UNREVIEWED_BAND;
  const ratio = candidatePricePerUnit / baselinePricePerUnit;
  return ratio >= band.min && ratio <= band.max;
}

/** Median of a non-empty numeric list; null when there's nothing to average. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
