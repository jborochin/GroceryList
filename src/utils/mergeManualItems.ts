import { GroceryItem, Ingredient, ManualItem } from '../types';
import { mergeGroup } from './ingredientAggregator';
import { canonicalizeUnit } from './ingredientParser';
import { normalizeName } from './normalizeName';

/**
 * Folds user-added manual items into an already-computed grocery list. Runs *after*
 * pantry deduction so manual items are never reduced or removed by the pantry — what
 * the user adds always appears. Manual items still merge with recipe-derived items of
 * the same normalized name (family-aware, via the shared aggregator merge).
 */
export function mergeManualItems(items: GroceryItem[], manual: ManualItem[]): GroceryItem[] {
  if (manual.length === 0) return items;

  // Build a canonical Ingredient per manual entry: keep the user's typed name, but
  // canonicalize the unit ("lbs" → "lb") so quantities merge/convert/price consistently.
  const groups = new Map<string, { display: string; ings: Ingredient[] }>();
  for (const m of manual) {
    const display = m.name.trim();
    const normalized = normalizeName(display);
    if (!normalized) continue;
    const ing: Ingredient = {
      name: display,
      quantity: m.quantity > 0 ? m.quantity : 1,
      unit: canonicalizeUnit(m.unit),
    };
    const g = groups.get(normalized);
    if (g) g.ings.push(ing);
    else groups.set(normalized, { display, ings: [ing] });
  }

  if (groups.size === 0) return items;

  const result: GroceryItem[] = [];
  const handled = new Set<string>();

  // Rebuild existing items that have manual additions; pass others through untouched.
  for (const item of items) {
    const g = groups.get(item.name);
    if (!g) {
      result.push(item);
      continue;
    }
    handled.add(item.name);
    const existingIngs: Ingredient[] = item.entries.map((e) => ({
      name: item.displayName,
      quantity: e.quantity,
      unit: e.unit,
    }));
    result.push(mergeGroup(item.name, item.displayName, [...existingIngs, ...g.ings]));
  }

  // Append manual-only items that didn't match any existing row.
  for (const [normalized, { display, ings }] of groups) {
    if (handled.has(normalized)) continue;
    result.push(mergeGroup(normalized, display, ings));
  }

  result.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return result;
}
