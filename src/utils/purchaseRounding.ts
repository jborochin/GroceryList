import { GroceryItem, GroceryEntry } from '../types';
import { getProfile, convertMeasure, PurchaseProfile } from './purchaseProfile';
import { getFamily } from './unitConversion';

/**
 * Pipeline step: rewrite each item's quantity into the unit the store actually sells it in,
 * rounded up to a whole purchasable pack. Runs after pantry deduction and manual merge, before
 * pricing (so price reflects the real purchase).
 *
 * Only items whose sell unit is a *count* (each/head/block/bag/bottle…) are rounded — those are
 * the indivisible buys you "can't buy a fraction of". Items sold by weight or volume (chicken by
 * the pound, oil by fluid ounce) are left continuous, since you can buy a fractional amount.
 * Items with no profile pass through untouched.
 */
export function roundToPurchasable(items: GroceryItem[]): GroceryItem[] {
  return items.map((item) => {
    const profile = getProfile(item.name);
    if (!profile || getFamily(profile.sellUnit) !== 'count') return item;
    return { ...item, entries: roundEntries(item.entries, profile) };
  });
}

function roundEntries(entries: GroceryEntry[], profile: PurchaseProfile): GroceryEntry[] {
  let sold = 0;
  let hasSold = false;
  const leftovers: GroceryEntry[] = [];

  for (const entry of entries) {
    const inSellUnit = convertMeasure(entry.quantity, entry.unit, profile.sellUnit, profile);
    if (inSellUnit === null) {
      leftovers.push(entry); // can't express in the sell unit — leave it as-is
    } else {
      sold += inSellUnit;
      hasSold = true;
    }
  }

  if (!hasSold) return leftovers;

  const pack = profile.packSize > 0 ? profile.packSize : 1;
  const packs = Math.ceil(roundEps(sold / pack)) * pack;
  return [{ quantity: packs, unit: profile.sellUnit }, ...leftovers];
}

// Guard against floating-point noise pushing an exact value (e.g. 2.0000000004) up a whole pack.
function roundEps(n: number): number {
  return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
}
