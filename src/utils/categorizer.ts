import categoryKeywords from '../data/categoryKeywords.json';
import { normalizeName } from './normalizeName';

const SORTED_KEYWORDS: Array<[string, string]> = Object.entries(
  categoryKeywords as Record<string, string>
)
  .map(([k, v]) => [normalizeName(k), v] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

export function categorize(ingredientName: string): string {
  const name = normalizeName(ingredientName);
  for (const [keyword, category] of SORTED_KEYWORDS) {
    if (name.includes(keyword)) return category;
  }
  return 'Other';
}
