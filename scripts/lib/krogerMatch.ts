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
 * same as scripts/lib/blsPriceMapping.ts. It is also free of JSON imports, so the
 * same source runs unmodified inside a Deno edge function.
 */
import { BLEND_VETO_NOUNS } from './blendVetoNouns.ts';
import { normalizeName } from '../../src/utils/normalizeName.ts';

/**
 * Kroger's own aisle categories that contain food.
 *
 * The text gates below can only judge a description against a search term, and some
 * non-food SKUs read as a perfect match: searching "hanger" returns "Project Partners
 * Large Picture Hangers - Gold", which carries the head noun, trips no trap token, and
 * scores 1.00. Priced by weight that lands at $39.90/lb. Category is the only signal
 * that separates it from a cut of beef.
 *
 * This is an ALLOWLIST rather than a denylist of non-food aisles, because the two fail in
 * very different directions. A missing food category rejects a real match, and rejection
 * is safe — the ingredient keeps its bundled estimate. A missing non-food category ships
 * picture hangers as a grocery price. When a legitimate category is missing it shows up
 * immediately as a `non-food-category` rejection in the run report, which is the cheap
 * failure. Sampled from ~50 catalog ingredients across every aisle.
 */
export const FOOD_CATEGORIES: ReadonlySet<string> = new Set([
  'Adult Beverage',
  'Baking Goods',
  'Bakery',
  'Beverages',
  'Breakfast',
  'Canned & Packaged',
  'Condiment & Sauces',
  'Dairy',
  'Deli',
  'Frozen',
  'International',
  'Meat & Seafood',
  'Natural & Organic',
  'Pasta, Sauces, Grain',
  'Produce',
  'Snacks',
]);

/**
 * Could this product be food?
 *
 * Missing category data is treated as "maybe" rather than "no": some SKUs come back with
 * no categories at all, and the text gates still have to do their job there.
 */
export function hasFoodCategory(categories: string[] | null | undefined): boolean {
  if (!categories || categories.length === 0) return true;
  return categories.some((c) => FOOD_CATEGORIES.has(c));
}

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
 * Composite "count / measure" sizes, which retail uses for BOTH meanings:
 *
 *   "8 ct / 30.4 ounce"   8 patties totalling 30.4 oz   -> measure is the TOTAL
 *   "6 ct / 5.3 fl oz"    6 yogurt cups of 5.3 fl oz    -> measure is PER UNIT
 *
 * Nothing in the string distinguishes them, and guessing wrong is a 6-8x price
 * error. These are refused so the ingredient falls back to its bundled estimate.
 */
const COMPOSITE_SIZE = /\d\s*(?:ct|count|sticks?|pk)\b.*\//;

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
  if (!s || AMBIGUOUS_SIZE.test(s) || COMPOSITE_SIZE.test(s)) return null;

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
  // Prepared forms of a whole ingredient. These match the search term perfectly
  // ("Chicken Breast Deli Thin Sliced" for "chicken breast") and price close
  // enough to clear the sanity band, so only an explicit veto catches them.
  'deli',
  'smoothie',
  'jerky',
  'nugget',
  'patty',
  'sandwich',
  'pizza',
  'burrito',
  'trail',
  'salami',
  'crisp',
  'chip',
  'cracker',
  // Live regression: "apricot" matched "Private Selection Apricot Preserves"
  // (a cooked fruit spread, not the fresh fruit priceDatabase.json prices) at
  // 1.9x baseline — perfect token match, healthy pool (8), passed everything.
  // "preserve" not "preserves" — tokenize() runs normalizeName, which
  // singularizes "Preserves" to "preserve" before this list is checked.
  'preserve',
  'jam',
  'jelly',
  'marmalade',
  // Live regressions from the first large bootstrap batch. Each names the
  // ingredient it is made FROM, so it matches perfectly on tokens while being a
  // different product at a very different price per unit:
  //   "clam"        -> Progresso New England Clam Chowder      (0.26x)
  //   "cornmeal"    -> Dave's Killer Bread Oats & Blues Bread  (8.28x)
  //   "almond flour"-> Simple Mills Cupcake and Cake Mix       (21.87x)
  //   "pomegranate" -> Outshine Pomegranate Frozen Fruit Bars  (0.20x)
  //   "kiwi"        -> Capri Sun Strawberry Kiwi Juice Pouches (juice)
  //   "soba noodle" -> DOPE! Asian Street Fare Soba Noodle Salad (5.74x)
  // These are conditional on the token being absent from the SEARCH term, so a
  // future "coleslaw mix" or "granola bar" key still matches its own SKUs.
  'chowder',
  'soup',
  'salad',
  'juice',
  'pouch',
  'mix',
  'bar',
  // Flavored or battered variants of the plain ingredient, same shape as 'flavored'
  // above but the words retail actually uses:
  //   "pistachio" -> Simple Truth Hot Honey Seasoned Pistachio Kernels
  //   "calamari"  -> Private Selection Oven Ready Breaded Calamari
  'seasoned',
  'breaded',
];

/**
 * Multi-vegetable/fruit blends name one ingredient among several ("Red
 * Potatoes Carrots Onions & Zucchini Blend"), so a bare single-word search
 * term like "zucchini" or "carrot" passes the head-noun check against the
 * whole product, not just its share of it.
 *
 * Gated to single-token search terms only (not folded into TRAP_TOKENS,
 * which applies regardless of term length) — a multi-word term like
 * "stir-fry vegetable" IS itself a blend product by design, and vetoing on
 * "blend" there would reject its own correct match.
 */
const BLEND_TOKENS = ['blend', 'medley'];

/**
 * Word PAIRS that only mean "not food" together — unlike TRAP_TOKENS, a
 * single word here is too common in legitimate descriptions to blacklist
 * alone.
 *
 * Live regression: "cornstarch" matched "Comforts Fresh Scent Pure Cornstarch
 * Baby Powder". A bare "baby" trap would also reject "Baby Carrots" — an
 * ordinary, extremely common carrot SKU — so only the pair together (baby
 * powder specifically) is disqualifying.
 */
const PHRASE_TRAPS: ReadonlyArray<readonly [string, string]> = [['baby', 'powder']];

/**
 * "dried" is not a universal trap, unlike TRAP_TOKENS — `raisin` legitimately
 * matches "Sun-Maid California Sun-Dried Raisins" (a raisin IS a dried grape,
 * and the catalog has no separate fresh-vs-dried distinction for it). But
 * "apricot" and other fresh-produce keys mean the fresh fruit; a live
 * regression found the median for "apricot" landing on a dried SKU
 * (Kroger Probiotic Dried Apricots, $11.17/lb) instead of the ~$4/lb fresh
 * fruit, because dried fruit runs 3-4x pricier per lb (less weight, same
 * fruit) and skewed the whole candidate pool. Allowlist covers ingredients
 * that ARE inherently sold dried.
 */
const DRIED_PRODUCT_ALLOWLIST = new Set(['raisin']);

const WORD_SPLIT = /[^a-z0-9]+/;

/**
 * Tokens are singularized with the app's own normalizeName so the matcher sees
 * names the same way the price database does — without this, a search for
 * "tortilla" cannot match a SKU described as "Tortillas".
 */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter(Boolean)
    .map((t) => normalizeName(t))
    .filter(Boolean);
}

/**
 * Live regression: "zucchini" matched "Pictsweet Farms Red Potatoes Carrots
 * Onions Zucchini Frozen Vegetables" at 2.5x baseline. Nothing marks that
 * description as a blend (no "Blend"/"Medley" word — see BLEND_TOKENS), but
 * it names three OTHER known single-ingredient nouns alongside the search
 * term, which a genuine single-ingredient SKU never does.
 *
 * The co-occurrence count below is deliberately >=3, not >=2: a single
 * product commonly names one or two of its own ingredients in the title
 * ("Oats and Honey Granola", "Flax Oat Bran ... Pita Bread", "Quinoa & Brown
 * Rice with Garlic") without being a multi-item bag. >=2 rejected all three
 * of those live matches as false positives; only the true multi-vegetable
 * bag cleared 3.
 *
 * The noun set is frozen in blendVetoNouns.ts rather than derived from the
 * catalog — see that file for why deriving it made every ingredient addition
 * a silent matcher change.
 */
const MIN_COOCCURRING_INGREDIENTS_TO_VETO = 3;

const KNOWN_SINGLE_WORD_INGREDIENTS = BLEND_VETO_NOUNS;

/**
 * How many words a SKU description carries. Used only as a tie-breaker between
 * candidates that match equally well: retail search happily returns
 * "Oscar Mayer Deli Fresh Rotisserie Seasoned Chicken Breast" for "chicken
 * breast", and the plainer "Boneless Skinless Chicken Breast" is nearly always
 * the better stand-in for a recipe ingredient.
 *
 * This is a tie-breaker rather than part of the score on purpose — folding it
 * into the score would punish single-word terms, whose best matches are often
 * verbose ("Kroger Grade A Large White Eggs" is a perfect match for "eggs").
 */
export function descriptionSpecificity(description: string | null | undefined): number {
  return description ? tokenize(description).length : Number.MAX_SAFE_INTEGER;
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

  for (const [a, b] of PHRASE_TRAPS) {
    if (descSet.has(a) && descSet.has(b) && !(termSet.has(a) && termSet.has(b))) return 0;
  }

  if (
    descSet.has('dried') &&
    !termSet.has('dried') &&
    !termTokens.some((t) => DRIED_PRODUCT_ALLOWLIST.has(t))
  ) {
    return 0;
  }

  if (termTokens.length === 1) {
    for (const blendWord of BLEND_TOKENS) {
      if (descSet.has(blendWord) && !termSet.has(blendWord)) return 0;
    }

    const otherKnownIngredients = new Set(
      descTokens.filter((t) => t !== termTokens[0] && KNOWN_SINGLE_WORD_INGREDIENTS.has(t))
    );
    if (otherKnownIngredients.size >= MIN_COOCCURRING_INGREDIENTS_TO_VETO) return 0;
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

/**
 * Pick the mid-priced element of a candidate list.
 *
 * Retail search returns a spread for any ingredient — the store brand at the
 * bottom, organic/premium at the top. Taking the cheapest (which "plainest
 * description" effectively did) biases grocery totals low: Kroger's store-brand
 * chicken breast is $2.89/lb against a $4.18 BLS national average, because BLS
 * averages all brands and cuts. Taking the median candidate lands on what a
 * typical shopper actually puts in the cart.
 *
 * Ties break on the secondary value (description length), and even-sized pools
 * take the LOWER middle, so the estimate leans conservative rather than
 * premium. Returns null for an empty pool.
 */
export function pickMedianBy<T>(
  items: T[],
  primary: (item: T) => number,
  secondary: (item: T) => number
): T | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort(
    (a, b) => primary(a) - primary(b) || secondary(a) - secondary(b)
  );
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Median of a non-empty numeric list; null when there's nothing to average. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
