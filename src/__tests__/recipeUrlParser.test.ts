jest.mock('../lib/supabase', () => ({
  supabaseConfigured: false,
  getSupabase: () => {
    throw new Error('supabase not configured in tests');
  },
}));

import {
  extractJsonLdBlocks,
  findRecipeNode,
  parseInstructions,
  parseNutrition,
  parseRecipeFromUrl,
  RecipeParseError,
  scrapeNutritionFromHtml,
} from '../utils/recipeUrlParser';

describe('recipeUrlParser (pure helpers)', () => {
  it('extracts JSON-LD blocks', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type":"Recipe","name":"Hello"}</script>
        <script>not json</script>
        <script type="application/ld+json">{"@type":"Thing"}</script>
      </head></html>
    `;
    const result = extractJsonLdBlocks(html);
    expect(result.blocks).toHaveLength(2);
    expect(result.scriptsFound).toBe(2);
  });

  it('counts scripts found even when JSON is invalid', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Recipe","name":"Good"}</script>
      <script type="application/ld+json">{ this is not valid json </script>
    `;
    const result = extractJsonLdBlocks(html);
    expect(result.scriptsFound).toBe(2);
    expect(result.blocks).toHaveLength(1);
  });

  it('finds a Recipe node at top level', () => {
    const node = findRecipeNode([{ '@type': 'Recipe', name: 'X' }]);
    expect(node).not.toBeNull();
    expect(node?.name).toBe('X');
  });

  it('finds a Recipe inside @graph', () => {
    const node = findRecipeNode([
      {
        '@graph': [
          { '@type': 'WebPage', name: 'Page' },
          { '@type': 'Recipe', name: 'Tasty' },
        ],
      },
    ]);
    expect(node?.name).toBe('Tasty');
  });

  it('handles array @type', () => {
    const node = findRecipeNode([{ '@type': ['Thing', 'Recipe'], name: 'Y' }]);
    expect(node?.name).toBe('Y');
  });

  it('returns null when no recipe present', () => {
    const node = findRecipeNode([{ '@type': 'WebPage' }]);
    expect(node).toBeNull();
  });
});

describe('parseInstructions', () => {
  it('splits a single string on newlines', () => {
    expect(parseInstructions('Preheat oven.\nMix ingredients.\n\nBake 30 min.')).toEqual([
      'Preheat oven.',
      'Mix ingredients.',
      'Bake 30 min.',
    ]);
  });

  it('handles an array of strings', () => {
    expect(parseInstructions(['Step one', 'Step two'])).toEqual(['Step one', 'Step two']);
  });

  it('extracts text from HowToStep objects', () => {
    expect(
      parseInstructions([
        { '@type': 'HowToStep', text: 'Chop onions' },
        { '@type': 'HowToStep', text: 'Saute in pan' },
      ]),
    ).toEqual(['Chop onions', 'Saute in pan']);
  });

  it('flattens HowToSection containing itemListElement of steps', () => {
    expect(
      parseInstructions([
        {
          '@type': 'HowToSection',
          name: 'Prep',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Wash veg' },
            { '@type': 'HowToStep', text: 'Dice onion' },
          ],
        },
        {
          '@type': 'HowToSection',
          itemListElement: [{ '@type': 'HowToStep', text: 'Cook for 20 min' }],
        },
      ]),
    ).toEqual(['Wash veg', 'Dice onion', 'Cook for 20 min']);
  });

  it('strips HTML tags from step text', () => {
    expect(parseInstructions([{ '@type': 'HowToStep', text: 'Add <b>salt</b> to taste.' }])).toEqual([
      'Add salt to taste.',
    ]);
  });

  it('falls back to the name field when text is absent', () => {
    expect(parseInstructions([{ '@type': 'HowToStep', name: 'Mix well' }])).toEqual(['Mix well']);
  });

  it('returns empty array for missing/empty input', () => {
    expect(parseInstructions(undefined)).toEqual([]);
    expect(parseInstructions(null)).toEqual([]);
    expect(parseInstructions('')).toEqual([]);
    expect(parseInstructions([])).toEqual([]);
  });
});

describe('parseRecipeFromUrl (integration with mocked fetch)', () => {
  const originalFetch = global.fetch;
  const g = globalThis as { document?: unknown; window?: unknown };

  afterEach(() => {
    global.fetch = originalFetch;
    delete g.document;
    delete g.window;
  });

  const simulateWebRuntime = () => {
    g.document = {};
    g.window = {};
  };

  const mockFetchHtml = (html: string, ok = true, status = 200) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: async () => html,
    }) as unknown as typeof fetch;
  };

  it('succeeds with a valid JSON-LD Recipe', async () => {
    mockFetchHtml(`
      <html><script type="application/ld+json">
        {"@type":"Recipe","name":"Cake","recipeIngredient":["1 cup flour"],"recipeYield":"4 servings"}
      </script></html>
    `);
    const recipe = await parseRecipeFromUrl('https://example.com/cake');
    expect(recipe.title).toBe('Cake');
    expect(recipe.servings).toBe(4);
    expect(recipe.ingredients).toHaveLength(1);
  });

  it('averages a recipeYield range', async () => {
    mockFetchHtml(`
      <html><script type="application/ld+json">
        {"@type":"Recipe","name":"Stew","recipeIngredient":["1 cup flour"],"recipeYield":"4-6 servings"}
      </script></html>
    `);
    const recipe = await parseRecipeFromUrl('https://example.com/stew');
    expect(recipe.servings).toBe(5);
  });

  it('averages a "to" recipeYield range', async () => {
    mockFetchHtml(`
      <html><script type="application/ld+json">
        {"@type":"Recipe","name":"Soup","recipeIngredient":["1 cup flour"],"recipeYield":"6 to 8"}
      </script></html>
    `);
    const recipe = await parseRecipeFromUrl('https://example.com/soup');
    expect(recipe.servings).toBe(7);
  });

  it('throws network on HTTP 404', async () => {
    mockFetchHtml('', false, 404);
    await expect(parseRecipeFromUrl('https://example.com/missing')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('throws cors when web fetch rejects with TypeError', async () => {
    simulateWebRuntime();
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(parseRecipeFromUrl('https://blocked.example/recipe')).rejects.toMatchObject({
      kind: 'cors',
    });
  });

  it('throws network (not cors) when native fetch rejects with TypeError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    await expect(parseRecipeFromUrl('https://offline.example/recipe')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('throws malformed when JSON-LD scripts are present but invalid', async () => {
    mockFetchHtml(`
      <script type="application/ld+json">{ not valid json at all </script>
      <script type="application/ld+json">{ also broken: , }</script>
    `);
    await expect(parseRecipeFromUrl('https://example.com/broken')).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws not-found when valid JSON-LD has no Recipe type', async () => {
    mockFetchHtml(`
      <script type="application/ld+json">
        {"@type":"WebPage","name":"Not a recipe"}
      </script>
    `);
    await expect(parseRecipeFromUrl('https://example.com/article')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('surfaces RecipeParseError instances (not plain Errors)', async () => {
    mockFetchHtml('', false, 500);
    const err = await parseRecipeFromUrl('https://example.com/fail').catch((e) => e);
    expect(err).toBeInstanceOf(RecipeParseError);
  });

  it('flags all four macros missing when JSON-LD lacks a nutrition node', async () => {
    mockFetchHtml(`
      <html><script type="application/ld+json">
        {"@type":"Recipe","name":"Plain","recipeIngredient":["1 cup flour"],"recipeYield":"2"}
      </script></html>
    `);
    const recipe = await parseRecipeFromUrl('https://example.com/plain');
    // Without supabase configured, the fallback is skipped, so nutrition stays undefined.
    expect(recipe.nutritionPerServing).toBeUndefined();
    // estimatedMacros should not be set when the fallback didn't run.
    expect(recipe.estimatedMacros).toBeUndefined();
  });

  it('fills macros from HTML when JSON-LD has only calories (prevention.com shape)', async () => {
    mockFetchHtml(`
      <html>
        <script type="application/ld+json">
          {"@type":"Recipe","name":"Roasted Chicken","recipeIngredient":["4 chicken thighs"],"recipeYield":"4",
           "nutrition":{"@type":"NutritionInformation","calories":"526 calories"}}
        </script>
        <p>Nutrition per serving: 526 cal, 38 g pro, 29 g carb, 3 g fiber, 1.5 g sugars (0 g added sugars), 29 g fat (6.5 g sat fat), 187 mg chol, 778 mg sodium</p>
      </html>
    `);
    const recipe = await parseRecipeFromUrl('https://example.com/chicken');
    expect(recipe.nutritionPerServing).toEqual({
      calories: 526,
      proteinG: 38,
      carbsG: 29,
      fatG: 29,
    });
    // HTML-scraped values are authoritative — no estimated badge.
    expect(recipe.estimatedMacros).toBeUndefined();
  });
});

describe('scrapeNutritionFromHtml', () => {
  it('extracts all four macros from prevention.com-style text', () => {
    const html =
      '<p>Nutrition per serving: 526 cal, 38 g pro, 29 g carb, 3 g fiber, 1.5 g sugars (0 g added sugars), 29 g fat (6.5 g sat fat), 187 mg chol, 778 mg sodium</p>';
    expect(scrapeNutritionFromHtml(html)).toEqual({
      calories: 526,
      proteinG: 38,
      carbsG: 29,
      fatG: 29,
    });
  });

  it('excludes "sat fat" from the total-fat match', () => {
    const html = '<div>Nutrition: 29 g fat (6.5 g sat fat)</div>';
    expect(scrapeNutritionFromHtml(html).fatG).toBe(29);
  });

  it('excludes "saturated fat" from the total-fat match', () => {
    const html = '<div>Nutrition: 22 g fat (5 g saturated fat)</div>';
    expect(scrapeNutritionFromHtml(html).fatG).toBe(22);
  });

  it('reads schema.org microdata from <meta itemprop content>', () => {
    const html = '<meta itemprop="proteinContent" content="22 g">';
    expect(scrapeNutritionFromHtml(html).proteinG).toBe(22);
  });

  it('reads schema.org microdata from inner text', () => {
    const html =
      '<div itemprop="nutrition"><span itemprop="proteinContent">22g</span><span itemprop="fatContent">10 g</span></div>';
    const result = scrapeNutritionFromHtml(html);
    expect(result.proteinG).toBe(22);
    expect(result.fatG).toBe(10);
  });

  it('handles meta with content before itemprop', () => {
    const html = '<meta content="300" itemprop="calories">';
    expect(scrapeNutritionFromHtml(html).calories).toBe(300);
  });

  it('returns empty object when no nutrition context is present', () => {
    const html = '<p>An article about losing 38 g of weight after 526 calories.</p>';
    expect(scrapeNutritionFromHtml(html)).toEqual({});
  });

  it('combines microdata (when present) with text scrape for the rest', () => {
    const html = `
      <meta itemprop="calories" content="300">
      <p>Nutrition per serving: 30 g pro, 40 g carb, 10 g fat</p>
    `;
    expect(scrapeNutritionFromHtml(html)).toEqual({
      calories: 300,
      proteinG: 30,
      carbsG: 40,
      fatG: 10,
    });
  });

  it('parses label-first form (Protein: 22g)', () => {
    const html = '<div>Nutrition Facts: Protein: 22g, Carbs: 40g, Fat: 10g, Calories: 320</div>';
    expect(scrapeNutritionFromHtml(html)).toEqual({
      calories: 320,
      proteinG: 22,
      carbsG: 40,
      fatG: 10,
    });
  });

  it('skips decoy "nutrition" occurrences (URL paths, nav links, JSON-LD) and finds the real block', () => {
    // Mirrors prevention.com: the word "nutrition" appears 30+ times in head/nav/JSON-LD
    // before the actual macro line, which lives deep in the body.
    const html = `
      <link rel="canonical" href="https://example.com/food-nutrition/recipes/roasted-chicken/">
      <meta name="sailthru.tags" content="food-nutrition,Food &amp; Nutrition,recipes">
      <script type="application/ld+json">{"keywords":["NUTRITION: healthy","NUTRITION: low-calorie"]}</script>
      <nav><a href="/food-nutrition/">Food &amp; Nutrition</a></nav>
      <section><p><em><strong>Nutrition per serving</strong>: 526 cal, 38 g pro, 29 g carb, 3 g fiber, 1.5 g sugars (0 g added sugars), 29 g fat (6.5 g sat fat), 187 mg chol, 778 mg sodium</em></p></section>
    `;
    expect(scrapeNutritionFromHtml(html)).toEqual({
      calories: 526,
      proteinG: 38,
      carbsG: 29,
      fatG: 29,
    });
  });
});

describe('parseNutrition', () => {
  it('reports all four fields missing when none present', () => {
    expect(parseNutrition({})).toEqual({ values: undefined, missing: ['calories', 'proteinG', 'carbsG', 'fatG'] });
  });

  it('reports only the missing fields when calories is present', () => {
    const result = parseNutrition({ calories: '320 kcal' });
    expect(result.missing).toEqual(['proteinG', 'carbsG', 'fatG']);
    expect(result.values).toEqual({ calories: 320, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it('reports nothing missing when all four are present', () => {
    const result = parseNutrition({
      calories: 400,
      proteinG: undefined,
      proteinContent: '30 g',
      carbohydrateContent: '40 g',
      fatContent: '15 g',
    });
    expect(result.missing).toEqual([]);
    expect(result.values).toEqual({ calories: 400, proteinG: 30, carbsG: 40, fatG: 15 });
  });

  it('parses numeric strings with stray units', () => {
    const result = parseNutrition({ proteinContent: '12.5g' });
    expect(result.values?.proteinG).toBe(12.5);
    expect(result.missing).toEqual(['calories', 'carbsG', 'fatG']);
  });
});
