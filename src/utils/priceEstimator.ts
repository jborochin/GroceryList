import { GroceryItem, PriceOverride } from '../types';
import { convert } from './unitConversion';
import { findPrice } from './priceLookup';
import { getProfile, convertMeasure } from './purchaseProfile';

// Re-exported for existing call sites/tests that import findPrice from here.
export { findPrice };

export function estimatePriceForItem(
  item: GroceryItem,
  overrides: Record<string, PriceOverride> = {}
): GroceryItem {
  const priceEntry = findPrice(item.name, overrides);
  if (!priceEntry) {
    return {
      ...item,
      entries: item.entries.map((e) => ({ ...e, price: undefined, priceReason: 'no-match' })),
      estimatedPrice: undefined,
      hasPriceGap: true,
    };
  }

  // A purchase profile lets us price sell units that cross a unit family (e.g. a broccoli
  // `head` priced per `lb`), which plain convert() can't bridge. Falls back to convert() when
  // there's no profile, preserving the original unit-conflict behavior for unbridgeable items.
  const profile = getProfile(item.name);

  let total = 0;
  let gap = false;
  const newEntries = item.entries.map((e) => {
    const converted =
      convert(e.quantity, e.unit, priceEntry.unit) ??
      convertMeasure(e.quantity, e.unit, priceEntry.unit, profile);
    if (converted === null) {
      gap = true;
      return { ...e, price: undefined, priceReason: 'unit-conflict' as const };
    }
    const price = converted * priceEntry.pricePerUnit;
    total += price;
    return { ...e, price };
  });

  return {
    ...item,
    entries: newEntries,
    estimatedPrice: gap ? total || undefined : total,
    hasPriceGap: gap,
  };
}

export function estimatePrices(
  items: GroceryItem[],
  overrides: Record<string, PriceOverride> = {}
): { items: GroceryItem[]; total: number; unestimatedCount: number } {
  let total = 0;
  let unestimatedCount = 0;
  const enriched = items.map((item) => {
    const priced = estimatePriceForItem(item, overrides);
    if (priced.estimatedPrice !== undefined) total += priced.estimatedPrice;
    if (priced.hasPriceGap && priced.estimatedPrice === undefined) unestimatedCount += 1;
    return priced;
  });
  return { items: enriched, total, unestimatedCount };
}
