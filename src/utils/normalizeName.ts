const IRREGULAR_PLURALS: Record<string, string> = {
  tomatoes: 'tomato',
  potatoes: 'potato',
  leaves: 'leaf',
  loaves: 'loaf',
  knives: 'knife',
  mice: 'mouse',
  geese: 'goose',
  teeth: 'tooth',
  feet: 'foot',
  children: 'child',
  people: 'person',
  cherries: 'cherry',
  berries: 'berry',
  strawberries: 'strawberry',
  blueberries: 'blueberry',
  raspberries: 'raspberry',
  blackberries: 'blackberry',
  anchovies: 'anchovy',
};

const LEADING_ARTICLES = /^(?:the|a|an)\s+/;

/**
 * Canonicalize an ingredient name for grouping/lookup.
 * Lowercase, strip leading articles, naive singularize, collapse whitespace.
 */
export function normalizeName(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(LEADING_ARTICLES, '');
  n = n.replace(/\s+/g, ' ').trim();

  // Singularize the last word if it's a plural
  const tokens = n.split(' ');
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    tokens[tokens.length - 1] = singularize(last);
  }
  return tokens.join(' ');
}

function singularize(word: string): string {
  // Own-property check: `IRREGULAR_PLURALS['constructor']` is Object's constructor.
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_PLURALS, word)) return IRREGULAR_PLURALS[word];
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  return word;
}
