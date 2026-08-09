// Prep-state / quality / sourcing words that aren't the food itself. Shared by
// nutritionQuery.ts (CalorieNinjas inflates/double-counts when these surround
// the noun) and purchasableName.ts (grocery list should show the purchasable
// product, not the knife cut). We only strip *leading and trailing runs* of
// these, stopping at the first real food token from each end, so
// food-defining modifiers ("cherry tomatoes", "green onion", "olive oil",
// "ground beef") survive.
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
  'boneless',
  'skinless',
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

/**
 * Strip leading and trailing runs of descriptor tokens, treating commas as
 * plain word separators — handles both "noun, descriptor" (recipe sites'
 * trailing prep note) and "descriptor, descriptor noun" (e.g. "boneless,
 * skinless chicken breast") phrasing with one pass. Never strips to empty.
 */
export function stripDescriptors(name: string): string {
  const tokens = name.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return name;

  let start = 0;
  while (start < tokens.length - 1 && STRIP_LEADING.has(tokens[start].toLowerCase())) start++;

  let end = tokens.length;
  while (end > start + 1 && STRIP_LEADING.has(tokens[end - 1].toLowerCase())) end--;

  return tokens.slice(start, end).join(' ');
}
