import { GroceryItem, ItemOverride } from '../types';

/**
 * Pipeline step: applies user-saved displayName/quantity/unit/category overrides,
 * keyed by the item's normalized `name`. Runs after roundToPurchasable (an
 * explicit quantity/unit the user typed shouldn't be re-rounded to a pack size)
 * and before estimatePrices (so the edited quantity/unit gets priced). Only
 * `displayName` is ever rewritten — `name` (the join key used by price lookup,
 * pantry matching, checked/dismissed state, and manual-item matching) is left
 * untouched.
 *
 * When an override is present, entries collapse to the single explicit
 * {quantity, unit} pair the user saved, replacing whatever entries were merged
 * for that item. hasPriceGap/estimatedPrice are passed through unchanged —
 * estimatePrices recomputes both from `entries` unconditionally right after
 * this step runs.
 */
export function applyItemOverrides(
  items: GroceryItem[],
  overrides: Record<string, ItemOverride>
): GroceryItem[] {
  if (Object.keys(overrides).length === 0) return items;
  return items.map((item) => {
    const o = overrides[item.name];
    if (!o) return item;
    return {
      ...item,
      displayName: o.displayName,
      category: o.category,
      entries: [{ quantity: o.quantity, unit: o.unit }],
    };
  });
}
