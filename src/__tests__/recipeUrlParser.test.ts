import {
  extractJsonLdBlocks,
  findRecipeNode,
  parseInstructions,
  parseRecipeFromUrl,
  RecipeParseError,
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
});
