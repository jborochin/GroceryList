import { Ingredient } from '../types';

// Meal-prep creators split one ingredient list into named sub-recipes ("Chipotle
// Chicken Marinade", "Creamy Chipotle Sauce"). The parser records that on each
// Ingredient as `section`; this turns the flat array back into the runs a screen
// wants to render, without any screen re-deriving the walk.
//
// `index` is the ingredient's position in the ORIGINAL flat array. Everything
// that addresses an ingredient by number — cook mode's checked-ingredient
// indices, the editor's update/remove — must keep using it rather than the
// position within a run.

export interface SectionItem {
  ingredient: Ingredient;
  /** Position in the flat `ingredients` array this came from. */
  index: number;
}

export interface IngredientSection {
  /** Absent for a run of ingredients stated before any sub-recipe title. */
  title?: string;
  items: SectionItem[];
}

/**
 * Split ingredients into consecutive runs sharing a `section`.
 *
 * A list with no sections comes back as a single untitled run, so callers can
 * render the result unconditionally instead of branching on whether the recipe
 * happens to be sectioned. A title that reappears after a different one stays
 * two runs — document order is the recipe's own order and is not rearranged.
 */
export function toSections(ingredients: Ingredient[]): IngredientSection[] {
  const sections: IngredientSection[] = [];
  for (let index = 0; index < ingredients.length; index++) {
    const ingredient = ingredients[index];
    const title = ingredient.section;
    const current = sections[sections.length - 1];
    if (current && current.title === title) current.items.push({ ingredient, index });
    else sections.push({ title, items: [{ ingredient, index }] });
  }
  return sections;
}

/** Whether anything in the list carries a section title worth rendering. */
export function hasSections(ingredients: Ingredient[]): boolean {
  return ingredients.some((i) => !!i.section);
}
