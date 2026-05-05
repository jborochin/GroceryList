import { GroceryItem, PantryItem } from '../types';
import { normalizeName } from './normalizeName';
import { convert, getFamily } from './unitConversion';

/**
 * Subtract pantry holdings from the aggregated grocery list.
 *
 * - If a pantry match has no quantity → drop the grocery item entirely.
 * - If pantry has quantity + compatible unit with an entry → subtract; drop entry if ≤ 0.
 * - Entries with incompatible units are passed through unchanged.
 * - An item whose entries all drop is itself dropped.
 */
export function applyPantry(items: GroceryItem[], pantry: PantryItem[]): GroceryItem[] {
  const pantryByName = new Map<string, PantryItem[]>();
  for (const p of pantry) {
    const key = normalizeName(p.name);
    if (!key) continue;
    const arr = pantryByName.get(key) ?? [];
    arr.push(p);
    pantryByName.set(key, arr);
  }

  const result: GroceryItem[] = [];
  for (const item of items) {
    const matches = pantryByName.get(item.name);
    if (!matches || matches.length === 0) {
      result.push(item);
      continue;
    }

    // If any pantry entry has no quantity, drop the item
    if (matches.some((m) => m.quantity === undefined || m.unit === undefined)) {
      continue;
    }

    // Consumable pool keyed by unit
    const pool = matches.map((m) => ({ quantity: m.quantity!, unit: m.unit! }));

    const newEntries: GroceryItem['entries'] = [];
    for (const entry of item.entries) {
      let remaining = entry.quantity;
      const entryFamily = getFamily(entry.unit);
      if (entryFamily) {
        for (const p of pool) {
          if (p.quantity <= 0) continue;
          const pFamily = getFamily(p.unit);
          if (pFamily !== entryFamily) continue;
          const pantryInEntryUnits = convert(p.quantity, p.unit, entry.unit);
          if (pantryInEntryUnits === null) continue;
          const used = Math.min(pantryInEntryUnits, remaining);
          remaining -= used;
          // Consume from pool proportionally
          const consumed = convert(used, entry.unit, p.unit) ?? 0;
          p.quantity -= consumed;
          if (remaining <= 0.0001) break;
        }
      }
      if (remaining > 0.0001) {
        newEntries.push({ ...entry, quantity: remaining });
      }
    }

    if (newEntries.length > 0) {
      result.push({ ...item, entries: newEntries });
    }
  }
  return result;
}
