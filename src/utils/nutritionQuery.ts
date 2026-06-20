import { Ingredient } from '../types';

// CalorieNinjas' natural-language parser reads cooking *fractions* correctly but
// catastrophically misparses *decimals* — e.g. "0.25 cup feta" returns ~7x the
// real value and "1.5 cup rice" ~15x. Since parseIngredient stores every quantity
// as a decimal (1½→1.5, range 2-3→2.5, ¼→0.25), we must re-render quantities as
// fraction/mixed-number strings before sending them upstream. See
// supabase/functions/compute-nutrition and src/utils/recipeUrlParser.ts (Tier 3).

// Common cooking fractions CalorieNinjas parses reliably. We snap the fractional
// part of a quantity to the nearest of these. Sentinels: 0 → no fraction, 1 →
// rounds up into the whole part.
const COMMON_FRACTIONS: Array<[number, string]> = [
  [0, ''],
  [1 / 8, '1/8'],
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [3 / 8, '3/8'],
  [1 / 2, '1/2'],
  [5 / 8, '5/8'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [7 / 8, '7/8'],
  [1, ''],
];

// Units CalorieNinjas understands as measures. Anything else (each, clove, can,
// handful, …) is dropped so the food noun stands alone (e.g. "1 garlic"), which
// the parser handles far better than an unknown unit token.
const MEASURE_UNITS = new Set([
  'cup',
  'tbsp',
  'tsp',
  'oz',
  'fl oz',
  'lb',
  'g',
  'kg',
  'mg',
  'ml',
  'l',
  'pt',
  'qt',
  'gal',
]);

// Recipe shorthand CalorieNinjas doesn't recognize → expanded food name.
const NAME_ALIASES: Record<string, string> = {
  evoo: 'olive oil',
};

// Leading prep-state / quality / sourcing words that aren't the food itself.
// CalorieNinjas inflates or even double-counts when these precede the noun
// (e.g. "hard boiled pasture-raised eggs" parses as TWO items). We only strip a
// *leading run* of these, stopping at the first real food token, so food-defining
// modifiers ("cherry tomatoes", "green onion", "olive oil", "ground beef") survive.
const STRIP_LEADING = new Set([
  // prep state
  'boiled',
  'hard-boiled',
  'soft-boiled',
  'cooked',
  'raw',
  'roasted',
  'grilled',
  'fried',
  'baked',
  'steamed',
  'chopped',
  'diced',
  'sliced',
  'minced',
  'crumbled',
  'shredded',
  'grated',
  'halved',
  'mashed',
  'peeled',
  'cubed',
  // quality / size / sourcing
  'fresh',
  'freshly',
  'frozen',
  'organic',
  'ripe',
  'pasture-raised',
  'pastured',
  'free-range',
  'grass-fed',
  'large',
  'small',
  'medium',
  'hard',
  // manner adverbs
  'thinly',
  'finely',
  'roughly',
  'lightly',
  // non-food quantity words
  'handful',
  'handfuls',
]);

function stripLeadingDescriptors(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && STRIP_LEADING.has(tokens[i])) i++;
  // Never strip away the whole name (e.g. "crumbled" with no noun).
  if (i >= tokens.length) return name;
  return tokens.slice(i).join(' ');
}

/**
 * Render a numeric quantity as a CalorieNinjas-safe fraction/mixed-number string.
 * Never emits a decimal. Returns '' for non-positive/zero-rounding quantities so
 * the caller can fall back to a bare food name (CalorieNinjas then assumes ~100g).
 */
export function formatQuantity(q: number): string {
  if (!Number.isFinite(q) || q <= 0) return '';
  const whole = Math.floor(q);
  const frac = q - whole;

  let best = COMMON_FRACTIONS[0];
  let bestDist = Infinity;
  for (const entry of COMMON_FRACTIONS) {
    const d = Math.abs(frac - entry[0]);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }

  let intPart = whole;
  let fracStr = best[1];
  if (best[0] === 1) {
    intPart += 1;
    fracStr = '';
  }

  if (intPart === 0 && !fracStr) return '';
  if (intPart === 0) return fracStr;
  if (!fracStr) return String(intPart);
  return `${intPart} ${fracStr}`;
}

function cleanName(raw: string): string {
  // Drop trailing prep descriptors ("small potatoes, thinly sliced" → "small
  // potatoes"): CalorieNinjas splits on commas, turning the descriptor into a
  // phantom food. Take the first comma-delimited clause only.
  const firstClause = raw.split(',')[0].trim().toLowerCase();
  if (NAME_ALIASES[firstClause]) return NAME_ALIASES[firstClause];
  return stripLeadingDescriptors(firstClause);
}

/**
 * Turn a parsed Ingredient into a single CalorieNinjas query clause, e.g.
 * "1/4 cup feta cheese", "2 eggs", "2 1/2 potatoes". Returns '' when there's no
 * usable food name so callers can filter it out.
 */
export function ingredientToNutritionQuery(ing: Ingredient): string {
  const name = cleanName(ing.name ?? '');
  if (!name) return '';

  const qty = formatQuantity(ing.quantity);
  const unit = (ing.unit ?? '').trim().toLowerCase();
  const keepUnit = qty && MEASURE_UNITS.has(unit);

  const parts = [qty, keepUnit ? unit : '', name].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
