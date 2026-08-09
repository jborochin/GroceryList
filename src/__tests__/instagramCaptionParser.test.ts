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
});
