import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIngredient } from '../utils/ingredientParser';
import { parseRecipeFromCaption } from '../utils/instagramCaptionParser';

// Golden corpus of real captions, fetched from live reels with the crawler UA and
// saved verbatim (see `npm run ig:probe`). These encode *reality* — the unit tests
// in instagramCaptionParser.test.ts encode the rules. Both matter: every one of
// these captions groups its ingredients under sub-section titles the parser used
// to mistake for the end of the list, which is the shape that produced a recipe
// with 25 "instructions", 18 of which were ingredients.
//
// Re-fetch any of these with:
//   npm run ig:probe -- https://www.instagram.com/p/<shortcode>/ --caption
const caption = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures', 'instagram', 'captions', `${name}.txt`), 'utf8');

interface Expected {
  fixture: string;
  shortcode: string;
  title: string;
  servings: number;
  ingredientCount: number;
  instructionCount: number;
  firstInstruction: RegExp;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
  /** One ingredient drawn from each sub-section — the direct regression test. */
  spotChecks: Array<{ name: string; quantity: number; unit: string }>;
}

const CORPUS: Expected[] = [
  {
    fixture: 'crispy-cheesy-beef-tacos',
    shortcode: 'DbgHTSuCvk8',
    title: 'Crispy Cheesy Beef Tacos',
    // "Ingredients (Makes 10 Tacos)" wins over the blurb's "Macros Per Taco
    // (Makes 15+)" — and 10 is the arithmetically consistent yield: 1200g of
    // beef over 10 tacos lands at the creator's stated 294 cal.
    servings: 10,
    ingredientCount: 28,
    instructionCount: 5,
    firstInstruction: /make the sauce in a bowl/i,
    macros: { calories: 294, proteinG: 28, carbsG: 23, fatG: 10 },
    spotChecks: [
      { name: 'raw 5% fat ground beef', quantity: 1200, unit: 'g' }, // Juicy Taco Beef
      { name: 'white onion, chopped', quantity: 200, unit: 'g' }, // Veggie Mix
      { name: 'yogurt', quantity: 300, unit: 'g' }, // Honey Chilli Lime Sauce
    ],
  },
  {
    fixture: 'garlic-herb-grilled-chicken-bowl',
    shortcode: 'DbYmVApitx1',
    title: 'Garlic Herb Grilled Chicken Bowl',
    servings: 6,
    ingredientCount: 34,
    instructionCount: 6,
    firstInstruction: /trim excess fat from chicken thighs/i,
    macros: { calories: 650, proteinG: 52, carbsG: 59, fatG: 22 },
    spotChecks: [
      { name: 'raw boneless chicken thighs', quantity: 1200, unit: 'g' },
      { name: 'uncooked basmati rice', quantity: 300, unit: 'g' },
      { name: 'sumac', quantity: 2, unit: 'tsp' },
      { name: 'light mayo', quantity: 100, unit: 'g' },
    ],
  },
  {
    // No "Instructions" header at all — the steps are bullets interleaved into
    // the ingredient sections. Every one of them used to be discarded silently.
    fixture: 'orange-pepper-chicken-rice-bowls',
    shortcode: 'DaneBWai4VO',
    title: 'Orange Pepper Chicken Rice Bowls',
    servings: 5,
    ingredientCount: 21,
    instructionCount: 5,
    firstInstruction: /marinate chicken for 30 mins/i,
    macros: { calories: 518, proteinG: 49, carbsG: 55, fatG: 12 },
    spotChecks: [
      { name: 'raw boneless skinless chicken thighs, trim any excess fat', quantity: 1100, unit: 'g' },
      { name: 'mini cucumbers, thinly sliced', quantity: 250, unit: 'g' },
      { name: 'uncooked basmati rice', quantity: 220, unit: 'g' },
    ],
  },
  {
    fixture: 'garlic-parmesan-chicken-wraps',
    shortcode: 'DaBQvjqOdK9',
    title: 'Crispy Garlic Parmesan Chicken Wraps',
    servings: 10,
    ingredientCount: 22,
    instructionCount: 8,
    firstInstruction: /slice chicken breast and thighs into cubes/i,
    macros: { calories: 423, proteinG: 41, carbsG: 25, fatG: 18 },
    spotChecks: [
      { name: 'raw chicken breast, cut into cubes', quantity: 600, unit: 'g' },
      { name: 'light evaporated milk', quantity: 350, unit: 'g' },
      { name: 'low carb wraps', quantity: 10, unit: 'each' },
    ],
  },
  {
    fixture: 'mexican-street-corn-chicken',
    shortcode: 'DZ8C0bJuz8-',
    title: 'Mexican Street Corn Chicken',
    servings: 6,
    ingredientCount: 24,
    instructionCount: 6,
    firstInstruction: /trim excess fat from boneless chicken thighs/i,
    macros: { calories: 637, proteinG: 57, carbsG: 55, fatG: 21 },
    spotChecks: [
      { name: 'raw boneless chicken thighs, fat trimmed', quantity: 1300, unit: 'g' },
      { name: 'canned sweet corn, drained', quantity: 600, unit: 'g' },
      { name: 'uncooked basmati rice', quantity: 250, unit: 'g' },
    ],
  },
  {
    fixture: 'garlic-butter-chicken-potatoes',
    shortcode: 'DZNlssHiqVc',
    title: 'Garlic Butter Chicken & Creamy Potatoes',
    // "Ingredients (To Make 4 Servings)" — the wordiest parenthetical form.
    servings: 4,
    ingredientCount: 21,
    instructionCount: 5,
    firstInstruction: /slice chicken breasts into cubes/i,
    macros: { calories: 551, proteinG: 51, carbsG: 43, fatG: 18 },
    spotChecks: [
      { name: 'raw chicken breast, cut into cubes', quantity: 800, unit: 'g' },
      { name: 'white potatoes cut into small cubes', quantity: 800, unit: 'g' },
      { name: 'light evaporated milk', quantity: 250, unit: 'ml' },
    ],
  },
  {
    fixture: 'creamy-chipotle-chicken-potatoes',
    shortcode: 'DYxQ8O3iKob',
    title: 'Creamy Chipotle Chicken & Potatoes',
    servings: 6,
    ingredientCount: 24,
    instructionCount: 6,
    firstInstruction: /let this marinate overnight/i,
    macros: { calories: 548, proteinG: 51, carbsG: 52, fatG: 17 },
    spotChecks: [
      { name: 'raw boneless chicken thighs, trim excess fat', quantity: 1200, unit: 'g' },
      { name: 'raw yellow potatoes, cubed', quantity: 1300, unit: 'g' },
      { name: 'light cream cheese', quantity: 110, unit: 'g' },
    ],
  },
];

describe('real Instagram caption corpus', () => {
  describe.each(CORPUS)('$fixture', (expected) => {
    const recipe = parseRecipeFromCaption(
      caption(expected.fixture),
      `https://www.instagram.com/p/${expected.shortcode}/`,
    );

    it('reads the title and yield', () => {
      expect(recipe.title).toBe(expected.title);
      expect(recipe.servings).toBe(expected.servings);
    });

    it('collects every ingredient sub-section into one list', () => {
      expect(recipe.ingredients).toHaveLength(expected.ingredientCount);
      for (const check of expected.spotChecks) {
        expect(recipe.ingredients).toContainEqual(expect.objectContaining(check));
      }
    });

    it('keeps the method separate from the ingredients', () => {
      expect(recipe.instructions).toHaveLength(expected.instructionCount);
      expect(recipe.instructions?.[0]).toMatch(expected.firstInstruction);
    });

    it('reads the macros the creator stated', () => {
      expect(recipe.nutritionPerServing).toEqual(expected.macros);
      expect(recipe.missingMacros).toEqual([]);
      // Creator-stated, so nothing should be badged as an estimate.
      expect(recipe.estimatedMacros).toBeUndefined();
    });
  });

  // Cross-cutting invariants. These catch the shape of the original bug — an
  // ingredient list bleeding into the method — regardless of exact counts, and
  // they keep working when a creator edits a caption.
  describe.each(CORPUS.map((c) => [c.fixture, c] as const))('%s invariants', (_name, expected) => {
    const recipe = parseRecipeFromCaption(caption(expected.fixture));

    it('has no ingredient that reads like a step', () => {
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.name).not.toMatch(
          /^(?:cook|bake|air fry|mix|preheat|marinate|serve|season|add|oven|spread|store|keep|let)\b/i,
        );
        expect(ingredient.name.length).toBeLessThanOrEqual(60);
      }
    });

    it('has no step that reads like an ingredient', () => {
      // The original bug put lines like "200g White Onion, chopped" and "1 Tsp
      // Salt" into the method, so the tell is a leading *measured* quantity.
      // Checked via parseIngredient rather than a regex because that is what
      // decides whether a line would have become a grocery row.
      //
      // A bare `quantity === 1` is not enough on its own: "Slice chicken breasts
      // into cubes." parses as 1 `slice`, since slice is a real count unit.
      const MEASURES = new Set(['g', 'kg', 'mg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp']);
      for (const step of recipe.instructions ?? []) {
        const parsed = parseIngredient(step);
        const measured = parsed.quantity !== 1 || MEASURES.has(parsed.unit);
        expect(measured).toBe(false);
      }
    });

    it('never leaks the macro line into either list', () => {
      const all = [...recipe.ingredients.map((i) => i.name), ...(recipe.instructions ?? [])];
      for (const text of all) {
        expect(text).not.toMatch(/\d+\s*(?:calories|kcal)\b/i);
      }
    });

    it('keeps quantities on nearly every ingredient', () => {
      // This creator gives a gram weight for almost everything, so a drop here
      // means the parser stopped reading quantities even if the counts still add
      // up. Mirrors the ratio `ig:probe` prints.
      const quantified = recipe.ingredients.filter(
        (i) => !(i.quantity === 1 && i.unit === 'each'),
      ).length;
      expect(quantified / recipe.ingredients.length).toBeGreaterThanOrEqual(0.8);
    });
  });
});
