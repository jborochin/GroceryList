import {
  GroceryItem,
  GroceryRecipeEntry,
  ItemOverride,
  ManualItem,
  MealPlanEntry,
  PantryItem,
  PriceOverride,
  Recipe,
} from '../types';
import { aggregate } from './ingredientAggregator';
import { applyPantry } from './pantryDeduction';
import { mergeManualItems } from './mergeManualItems';
import { roundToPurchasable } from './purchaseRounding';
import { applyItemOverrides } from './applyItemOverrides';
import { estimatePrices } from './priceEstimator';

export interface GroceryPipelineInput {
  plan: MealPlanEntry[];
  groceryRecipes: GroceryRecipeEntry[];
  recipes: Recipe[];
  pantry: PantryItem[];
  manualItems: ManualItem[];
  itemOverrides: Record<string, ItemOverride>;
  priceOverrides: Record<string, PriceOverride>;
  dismissedNames: string[];
}

export interface GroceryListResult {
  /** Every computed item, including dismissed ones — what the dismissed store prunes against. */
  all: GroceryItem[];
  /** What the user actually sees: `all` minus dismissed names. */
  items: GroceryItem[];
  /** Sum of `items` estimated prices. */
  total: number;
  /** Visible items with any price gap, partial or total. */
  unestimatedCount: number;
  /** Sorted, whole (never word-split) normalized names of `items` — what live pricing asks for. */
  names: string[];
}

/**
 * THE grocery-list computation, shared by every screen that shows a total.
 *
 * Home's "Estimated cost" used to run a shorter chain (no manual items, no purchase
 * rounding, no item overrides, no dismissed filter) and so disagreed with the List tab
 * whenever any of those applied — rounding alone makes it read low, since whole packs
 * always round up. One function means one number.
 *
 * Order matters and is documented in CLAUDE.md:
 * aggregate → applyPantry → mergeManualItems → roundToPurchasable → applyItemOverrides → estimatePrices.
 */
export function buildGroceryList(input: GroceryPipelineInput): GroceryListResult {
  // Both sources feed the aggregator. A recipe in both the plan and the grocery-only
  // list contributes twice — an intentional double batch.
  const agg = aggregate([...input.plan, ...input.groceryRecipes], input.recipes);
  const withPantry = applyPantry(agg, input.pantry);
  const withManual = mergeManualItems(withPantry, input.manualItems);
  // Round to what the store sells before pricing so the total reflects the real purchase;
  // apply user edits after rounding so a typed quantity isn't re-rounded to a pack size.
  const purchasable = roundToPurchasable(withManual);
  const overridden = applyItemOverrides(purchasable, input.itemOverrides);
  const priced = estimatePrices(overridden, input.priceOverrides);

  const dismissed = new Set(input.dismissedNames);
  const items = priced.items.filter((i) => !dismissed.has(i.name));
  let total = 0;
  let unestimatedCount = 0;
  for (const item of items) {
    if (item.estimatedPrice !== undefined) total += item.estimatedPrice;
    if (item.hasPriceGap) unestimatedCount += 1;
  }
  const names = items.map((i) => i.name).sort();
  return { all: priced.items, items, total, unestimatedCount, names };
}
