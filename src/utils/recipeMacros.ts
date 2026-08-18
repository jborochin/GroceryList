import { NutritionPerServing } from '../types';
import { computeMissingMacros } from './computeNutrition';
import { ingredientToNutritionQuery } from './nutritionQuery';
import { ParsedRecipe } from './recipeUrlParser';

// The last tier of nutrition resolution, shared by both importers. The URL path
// reaches here after JSON-LD and an HTML scrape have had their turn; the
// Instagram path after the caption's own "Macros Per Serving" line. Split out so
// the estimate exists in one place rather than two drifting copies.

export const ALL_MACRO_KEYS: Array<keyof NutritionPerServing> = [
  'calories',
  'proteinG',
  'carbsG',
  'fatG',
];

const ZERO: NutritionPerServing = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/**
 * Fill in macros the source didn't state, using CalorieNinjas.
 *
 * Total and non-throwing: when the estimate is unavailable — offline, Supabase
 * unconfigured, upstream error — the recipe comes back untouched and, crucially,
 * *without* an `estimatedMacros` key, so the review screen shows no "est." badge
 * for values that were never estimated.
 */
export async function estimateMissingMacros(
  parsed: ParsedRecipe,
  missing: Array<keyof NutritionPerServing>,
): Promise<ParsedRecipe> {
  if (missing.length === 0) return parsed;

  // Build clean, fraction-formatted query clauses from the parsed ingredients —
  // raw source strings (decimals, embedded commas, parentheticals, "evoo") make
  // CalorieNinjas wildly overestimate. See nutritionQuery.ts.
  const queries = parsed.ingredients.map(ingredientToNutritionQuery).filter(Boolean);
  if (queries.length === 0) return parsed;

  const computed = await computeMissingMacros(queries, parsed.servings, missing);
  if (!computed) return parsed;

  return {
    ...parsed,
    nutritionPerServing: { ...(parsed.nutritionPerServing ?? ZERO), ...computed },
    estimatedMacros: Object.keys(computed) as Array<keyof NutritionPerServing>,
  };
}
