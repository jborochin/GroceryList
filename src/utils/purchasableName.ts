import priceDatabase from '../data/priceDatabase.json';
import { normalizeName } from './normalizeName';
import { stripLeadingDescriptors } from './prepDescriptors';

// Some descriptor+noun phrases ARE the purchasable product ("diced tomatoes",
// "crushed tomatoes" are canned-goods SKUs with their own price/category/
// purchase-profile entries, distinct from fresh "tomato"). Protect any phrase
// that already resolves to an exact priceDatabase entry so we never strip it
// down to a different, wrong product.
const KNOWN_PRODUCT_NAMES = new Set(
  Object.keys(priceDatabase as Record<string, unknown>).map(normalizeName)
);

/**
 * Reduce a recipe/manual ingredient name to the way it's purchased at the
 * store, e.g. "diced red bell pepper" / "red bell pepper, diced" → "red bell
 * pepper". Used only at grocery-list aggregation time — recipe ingredient
 * lists keep the original prep-word text for cooking instructions.
 */
export function toPurchasableName(rawName: string): string {
  const firstClause = rawName.split(',')[0].trim();
  if (!firstClause) return rawName.trim();

  if (KNOWN_PRODUCT_NAMES.has(normalizeName(firstClause))) {
    return firstClause;
  }

  return stripLeadingDescriptors(firstClause) || firstClause;
}
