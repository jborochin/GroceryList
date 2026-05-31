import { GroceryItem, Ingredient, MealPlanEntry, Recipe } from '../types';
import { scaleIngredients } from './recipeScaling';
import { convert, getFamily, prettyUnit } from './unitConversion';
import { categorize } from './categorizer';
import { normalizeName } from './normalizeName';

export function aggregate(plan: MealPlanEntry[], recipes: Recipe[]): GroceryItem[] {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));

  // Collect all scaled ingredients across plan
  const all: Array<{ normalized: string; display: string; ing: Ingredient }> = [];
  for (const entry of plan) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const ratio = entry.desiredServings / Math.max(1, recipe.servings);
    const scaled = scaleIngredients(recipe.ingredients, ratio);
    for (const ing of scaled) {
      const normalized = normalizeName(ing.name);
      if (!normalized) continue;
      all.push({ normalized, display: ing.name, ing });
    }
  }

  // Group by normalized name
  const groups = new Map<string, { display: string; ings: Ingredient[] }>();
  for (const { normalized, display, ing } of all) {
    const g = groups.get(normalized);
    if (g) g.ings.push(ing);
    else groups.set(normalized, { display, ings: [ing] });
  }

  const items: GroceryItem[] = [];
  for (const [normalized, { display, ings }] of groups) {
    items.push(mergeGroup(normalized, display, ings));
  }

  // Sort alphabetically by display name (category grouping happens in the renderer)
  items.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return items;
}

export function mergeGroup(name: string, display: string, ings: Ingredient[]): GroceryItem {
  // Partition by unit family
  const byFamily = new Map<string, Ingredient[]>();
  const unknownUnitEntries: Ingredient[] = [];

  for (const ing of ings) {
    const family = getFamily(ing.unit);
    if (!family) {
      unknownUnitEntries.push(ing);
      continue;
    }
    const key = family === 'count' ? `count:${ing.unit}` : family;
    const arr = byFamily.get(key) ?? [];
    arr.push(ing);
    byFamily.set(key, arr);
  }

  const entries: GroceryItem['entries'] = [];

  for (const [, group] of byFamily) {
    if (group.length === 0) continue;
    // Sum within group by converting to the first entry's unit
    const baseUnit = pickBaseUnit(group);
    let total = 0;
    for (const ing of group) {
      const converted = convert(ing.quantity, ing.unit, baseUnit);
      if (converted === null) {
        // Shouldn't happen since we partitioned by family, but fall back safely
        entries.push({ quantity: ing.quantity, unit: ing.unit });
        continue;
      }
      total += converted;
    }
    const pretty = prettyUnit(total, baseUnit);
    entries.push({ quantity: pretty.quantity, unit: pretty.unit });
  }

  for (const ing of unknownUnitEntries) {
    entries.push({ quantity: ing.quantity, unit: ing.unit });
  }

  return {
    name,
    displayName: display,
    category: categorize(name),
    entries,
    hasPriceGap: false,
  };
}

function pickBaseUnit(group: Ingredient[]): string {
  // Pick the unit that minimizes conversion error: prefer the smallest base-unit to preserve precision
  return group[0].unit;
}
