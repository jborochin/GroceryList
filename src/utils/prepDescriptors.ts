// Leading prep-state / quality / sourcing words that aren't the food itself.
// Shared by nutritionQuery.ts (CalorieNinjas inflates/double-counts when these
// precede the noun) and purchasableName.ts (grocery list should show the
// purchasable product, not the knife cut). We only strip a *leading run* of
// these, stopping at the first real food token, so food-defining modifiers
// ("cherry tomatoes", "green onion", "olive oil", "ground beef") survive.
export const STRIP_LEADING = new Set([
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

export function stripLeadingDescriptors(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && STRIP_LEADING.has(tokens[i].toLowerCase())) i++;
  // Never strip away the whole name (e.g. "crumbled" with no noun).
  if (i >= tokens.length) return name;
  return tokens.slice(i).join(' ');
}
