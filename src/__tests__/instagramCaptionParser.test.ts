import { parseRecipeFromCaption } from '../utils/instagramCaptionParser';
import { RecipeParseError } from '../utils/recipeUrlParser';

const TUSCAN_CAPTION = `Creamy Tuscan Chicken 🍗✨

Serves 4

INGREDIENTS:
• 4 chicken breasts
• 1 cup heavy cream
• 3 cloves garlic, minced
• 1 cup sun dried tomatoes
• 2 cups fresh spinach
• Salt, pepper, Italian seasoning

INSTRUCTIONS:
1. Season chicken with salt and pepper on both sides.
2. Sear in oil over medium-high heat 6 mins per side.
3. Add garlic, cream, and tomatoes, then simmer.

Save this for your next dinner night! 🔖
#chicken #easyrecipes #tuscan`;

describe('parseRecipeFromCaption', () => {
  it('parses a realistic emoji caption with headers', () => {
    const r = parseRecipeFromCaption(TUSCAN_CAPTION);

    expect(r.title).toBe('Creamy Tuscan Chicken');
    expect(r.servings).toBe(4);

    // Six bulleted ingredients, none dropped.
    expect(r.ingredients).toHaveLength(6);
    const names = r.ingredients.map((i) => i.name);
    expect(names).toContain('chicken breasts');
    expect(names).toContain('heavy cream');
    const cream = r.ingredients.find((i) => i.name === 'heavy cream');
    expect(cream).toMatchObject({ quantity: 1, unit: 'cup' });

    // Instructions present, numbering stripped, CTA + hashtags excluded.
    expect(r.instructions).toBeDefined();
    expect(r.instructions).toHaveLength(3);
    expect(r.instructions?.[0]).toBe('Season chicken with salt and pepper on both sides.');
    const joined = (r.instructions ?? []).join(' ');
    expect(joined).not.toMatch(/save this/i);
    expect(joined).not.toMatch(/#/);
  });

  it('preserves a provided sourceUrl and leaves imageUrl undefined', () => {
    const r = parseRecipeFromCaption(TUSCAN_CAPTION, 'https://instagram.com/p/abc123');
    expect(r.sourceUrl).toBe('https://instagram.com/p/abc123');
    expect(r.imageUrl).toBeUndefined();
  });

  it('falls back to heuristic detection without an ingredients header', () => {
    const caption = `Weeknight Garlic Pasta

- 1 lb spaghetti
- 4 cloves garlic
- 3 tbsp olive oil
- 1/2 cup parmesan

Boil the pasta until al dente.
Toss with the garlic oil and cheese.

#pasta #dinner`;

    const r = parseRecipeFromCaption(caption);
    expect(r.title).toBe('Weeknight Garlic Pasta');
    expect(r.ingredients).toHaveLength(4);
    expect(r.ingredients.map((i) => i.name)).toContain('spaghetti');
    // The prose after the ingredient run becomes the instructions.
    expect(r.instructions).toBeDefined();
    expect((r.instructions ?? []).some((s) => /al dente/i.test(s))).toBe(true);
  });

  it('throws not-found when there is no ingredient block', () => {
    const caption = `Just got back from the most amazing dinner in Rome.
The pasta was unforgettable and the wine even better.
Cannot wait to go back next summer!

#travel #italy #foodie`;

    expect(() => parseRecipeFromCaption(caption)).toThrow(RecipeParseError);
    try {
      parseRecipeFromCaption(caption);
    } catch (err) {
      expect(err).toBeInstanceOf(RecipeParseError);
      expect((err as RecipeParseError).kind).toBe('not-found');
    }
  });

  describe('serving size extraction', () => {
    const base = (servingLine: string) =>
      `Quick Soup\n\n${servingLine}\n\nIngredients:\n- 2 cups broth\n- 1 carrot`;

    it.each([
      ['Serves 4', 4],
      ['Makes 6', 6],
      ['Yields 8 servings', 8],
      ['Serving for 2', 2],
      ['This makes about 12 muffins', 12],
    ])('reads "%s" as %i', (line, expected) => {
      expect(parseRecipeFromCaption(base(line)).servings).toBe(expected);
    });

    it('defaults to 4 when no serving phrase is present', () => {
      const r = parseRecipeFromCaption('Quick Soup\n\nIngredients:\n- 2 cups broth\n- 1 carrot');
      expect(r.servings).toBe(4);
    });
  });

  it('does not emit long sentence lines inside the ingredient block', () => {
    const caption = `Sheet Pan Veggies

Ingredients:
• 2 cups broccoli
• Make sure every single one of your vegetables is washed thoroughly before you start
• 1 tbsp olive oil

Instructions:
1. Roast at 425.`;

    const r = parseRecipeFromCaption(caption);
    expect(r.ingredients).toHaveLength(2);
    expect(r.ingredients.every((i) => !/washed thoroughly/i.test(i.name))).toBe(true);
  });

  // Both cases below were found by running the parser against live reels.
  describe('caption noise seen in the wild', () => {
    it('treats punctuation-only spacer lines as noise, not steps', () => {
      const caption = `Bbq Chicken Pasta

Ingredients:
• 300g pasta
• 500g chicken

Method:
.
Boil the pasta.
.
.
Serve.`;

      const r = parseRecipeFromCaption(caption);
      expect(r.instructions).toEqual(['Boil the pasta.', 'Serve.']);
    });

    it('strips inline brand attribution from ingredient names', () => {
      const caption = `Bbq Chicken Pasta

Ingredients:
• 300ml chicken stock- i used @knorruk
• 120g cheese- i used mix cheddar and mozzarella

Method:
1. Cook.`;

      const r = parseRecipeFromCaption(caption);
      expect(r.ingredients.map((i) => i.name)).toEqual(['chicken stock', 'cheese']);
      expect(r.ingredients[0]).toMatchObject({ quantity: 300, unit: 'ml' });
    });

    it('keeps food-defining hyphens that are not attribution', () => {
      const r = parseRecipeFromCaption(
        'Salad\n\nIngredients:\n• 1 cup sun-dried tomatoes\n• 2 hard-boiled eggs',
      );
      expect(r.ingredients.map((i) => i.name)).toEqual(['sun-dried tomatoes', 'hard-boiled eggs']);
    });
  });

  // Meal-prep creators write one "Ingredients" header and then split the list
  // into named sub-recipes. Before this, only the longest sub-block was read as
  // ingredients and every other one became instructions.
  describe('multi-section ingredient lists', () => {
    const SECTIONED = `Sheet Pan Chicken 🍗

Macros Per Serving (4 Total)

500 Calories | 40g Protein | 30g Carbs | 20g Fat

Ingredients (Makes 6 Servings)

The Chicken
- 800g Chicken Thighs
- 2 Tsp Paprika

Creamy Sauce
- 200g Yogurt
- 1 Tbsp Honey

👨‍🍳 Cooking Instructions

1. Roast the chicken.
2. Whisk the sauce.

Enjoy👨‍🍳
.
#mealprep`;

    it('merges every sub-section into one ingredient list', () => {
      const r = parseRecipeFromCaption(SECTIONED);
      expect(r.ingredients.map((i) => i.name)).toEqual([
        'chicken thighs',
        'paprika',
        'yogurt',
        'honey',
      ]);
    });

    it('drops sub-section titles rather than emitting them as steps', () => {
      const r = parseRecipeFromCaption(SECTIONED);
      expect(r.instructions).toEqual(['Roast the chicken.', 'Whisk the sauce.']);
    });

    it('reads a header carrying a parenthetical yield', () => {
      // "Ingredients (Makes 6 Servings)" beats "Macros Per Serving (4 Total)":
      // the yield attached to the ingredient list is the one those quantities
      // are actually written for.
      expect(parseRecipeFromCaption(SECTIONED).servings).toBe(6);
    });

    it('does not treat the "Enjoy 👨‍🍳" sign-off as an instructions header', () => {
      // The chef emoji alone used to make this a header, which truncated the
      // method at whatever came before it.
      expect(parseRecipeFromCaption(SECTIONED).instructions).toHaveLength(2);
    });

    it.each([
      ['Ingredients (Makes 10 Tacos)', 10],
      ['Ingredients (5 Servings)', 5],
      ['Ingredients (To Make 4 Servings)', 4],
      ['Ingredients (Makes 6)', 6],
    ])('reads the yield from "%s"', (header, expected) => {
      const r = parseRecipeFromCaption(`Dish\n\n${header}\n- 1 cup rice\n- 2 eggs`);
      expect(r.servings).toBe(expected);
    });

    it('ignores a parenthetical that states a size rather than a yield', () => {
      // "30g" and "9x13" are measurements; falling through to the caption scan
      // is the right answer, not 30 or 13 servings.
      const r = parseRecipeFromCaption(
        'Dish\n\nServes 3\n\nIngredients (30g portions, 9x13 pan)\n- 1 cup rice\n- 2 eggs',
      );
      expect(r.servings).toBe(3);
    });

    it('recognizes qualified header wording', () => {
      const r = parseRecipeFromCaption(
        'Dish\n\nAll Ingredients\n- 1 cup rice\n- 2 eggs\n\nImportant Cooking Instructions\n1. Cook it.',
      );
      expect(r.ingredients).toHaveLength(2);
      expect(r.instructions).toEqual(['Cook it.']);
    });

    it('does not treat an unqualified line ending in a header word as a header', () => {
      // "ends with a header word" alone would make both of these headers, and
      // the stray "steps" line would win the search for the real method.
      const r = parseRecipeFromCaption(
        'Dish\n\nReady in 5 steps\n\nIngredients:\n- 1 cup rice\n- 2 eggs\n\nMethod:\n1. Cook it.',
      );
      expect(r.instructions).toEqual(['Cook it.']);
      expect(r.ingredients).toHaveLength(2);
    });
  });

  describe('prose bullets inside an ingredient section', () => {
    it('routes a bulleted step to the instructions instead of the list', () => {
      // Captions with no "Instructions" header interleave steps into the
      // sections. These used to be discarded entirely.
      const r = parseRecipeFromCaption(
        `Orange Chicken

Ingredients (4 Servings)

- 1100g Chicken Thighs
- 30g Honey

• Marinate chicken for 30 mins or overnight for maximum depth of flavor
• Oven bake or air fry for 25-27 mins at 200C/400F

Crunchy Salad
- 250g Cucumbers`,
      );
      expect(r.ingredients.map((i) => i.name)).toEqual(['chicken thighs', 'honey', 'cucumbers']);
      expect(r.instructions).toEqual([
        'Marinate chicken for 30 mins or overnight for maximum depth of flavor',
        'Oven bake or air fry for 25-27 mins at 200C/400F',
      ]);
    });

    it('keeps short unquantified ingredients that start with a food word', () => {
      // The prose-bullet rule keys on word count and a leading imperative verb.
      // "Cream", "Pepper" and "Butter" are ingredients, not commands.
      const r = parseRecipeFromCaption(
        'Pasta\n\nIngredients:\n• Cream - 250-300 ml\n• Pepper - 2 tsp\n• Butter\n• Shredded Lettuce',
      );
      expect(r.ingredients).toHaveLength(4);
    });

    it('truncates a trailing commentary sentence off an ingredient', () => {
      const r = parseRecipeFromCaption(
        'Bowl\n\nIngredients:\n- 1 Large Orange Juiced + Orange Zest. I like to add bits of the pulp in the marinade for extra caramelized texture\n- 25g Light Soy Sauce',
      );
      expect(r.ingredients.map((i) => i.name)).toEqual([
        'large orange juiced + orange zest',
        'light soy sauce',
      ]);
    });
  });

  describe('creator-stated macros', () => {
    const withMacros = (macroBlock: string) =>
      `Dish\n\n${macroBlock}\n\nIngredients (2 Servings)\n- 1 cup rice\n- 2 eggs`;

    it('reads a single-line macro block', () => {
      const r = parseRecipeFromCaption(withMacros('294 Calories | 28g Protein | 23g Carbs | 10g Fat'));
      expect(r.nutritionPerServing).toEqual({
        calories: 294,
        proteinG: 28,
        carbsG: 23,
        fatG: 10,
      });
      expect(r.missingMacros).toEqual([]);
    });

    it('reads a label-first macro block split across two lines', () => {
      const r = parseRecipeFromCaption(withMacros('Calories- 539\nProtein- 45.8g'));
      expect(r.nutritionPerServing).toEqual({
        calories: 539,
        proteinG: 45.8,
        carbsG: 0,
        fatG: 0,
      });
      // Partial macros report the gap so the caller can estimate the rest.
      expect(r.missingMacros).toEqual(['carbsG', 'fatG']);
    });

    it('divides a whole-recipe macro block by the servings', () => {
      const r = parseRecipeFromCaption(
        withMacros('Total Macros For The Whole Recipe\n\n1000 Calories | 100g Protein'),
      );
      expect(r.nutritionPerServing).toMatchObject({ calories: 500, proteinG: 50 });
    });

    it('treats a yield parenthetical as a count, not a total-macros marker', () => {
      const r = parseRecipeFromCaption(
        withMacros('Macros Per Serving (6 Total)\n\n300 Calories | 30g Protein'),
      );
      // Per-serving, so not divided — and the ingredients header still wins the
      // servings race.
      expect(r.nutritionPerServing).toMatchObject({ calories: 300 });
      expect(r.servings).toBe(2);
    });

    it('does not mistake adjacent ingredients for a macro block', () => {
      // Without the "must include calories" rule these two lines combine into a
      // phantom macro block and vanish from the ingredient list.
      const r = parseRecipeFromCaption(
        'Shake\n\nIngredients:\n- 300g Low Fat Yogurt\n- 30g Whey Protein',
      );
      expect(r.ingredients).toHaveLength(2);
      expect(r.nutritionPerServing).toBeUndefined();
      expect(r.missingMacros).toEqual(['calories', 'proteinG', 'carbsG', 'fatG']);
    });

    it('reports every macro missing when the caption states none', () => {
      const r = parseRecipeFromCaption(TUSCAN_CAPTION);
      expect(r.nutritionPerServing).toBeUndefined();
      expect(r.missingMacros).toEqual(['calories', 'proteinG', 'carbsG', 'fatG']);
    });
  });
});
