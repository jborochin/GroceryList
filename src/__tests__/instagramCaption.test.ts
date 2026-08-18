import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decodeHtmlEntities,
  extractCaptionFromHtml,
  unwrapCaption,
} from '../utils/instagramCaption';
import { parseRecipeFromCaption } from '../utils/instagramCaptionParser';

// Fixtures are trimmed live responses (head meta only) captured with a crawler UA.
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'instagram', name), 'utf8');

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and astral hex entities', () => {
    expect(decodeHtmlEntities('&quot;hi&quot;')).toBe('"hi"');
    expect(decodeHtmlEntities('&#8226; item')).toBe('• item');
    expect(decodeHtmlEntities('&#x2022; bullet')).toBe('• bullet');
    expect(decodeHtmlEntities('pasta &#x1f35d;')).toBe('pasta 🍝');
  });

  // A two-pass decode would turn a literal "&amp;#x27;" into an apostrophe.
  it('decodes in a single pass so escaped entities survive', () => {
    expect(decodeHtmlEntities('&amp;#x27;')).toBe('&#x27;');
  });

  it('leaves unknown entities alone', () => {
    expect(decodeHtmlEntities('&notarealentity; &amp;')).toBe('&notarealentity; &');
  });

  // The line-based caption parser depends on this.
  it('preserves newlines', () => {
    expect(decodeHtmlEntities('a\nb\nc')).toBe('a\nb\nc');
  });
});

describe('unwrapCaption', () => {
  it('strips the likes/comments preamble', () => {
    const r = unwrapCaption('687 likes, 31 comments - recipebylayla on August 27, 2024: "Pasta". ');
    expect(r.caption).toBe('Pasta');
    expect(r.author).toBe('recipebylayla');
  });

  it('strips a bare username preamble', () => {
    const r = unwrapCaption('thecheeseball_ on April 24, 2024: "Chicken". ');
    expect(r.caption).toBe('Chicken');
    expect(r.author).toBe('thecheeseball_');
  });

  it('strips the og:title "on Instagram" form', () => {
    const r = unwrapCaption('Recipe Developer | UAE on Instagram: "Chicken". ');
    expect(r.caption).toBe('Chicken');
    expect(r.author).toBe('Recipe Developer | UAE');
  });

  it('handles abbreviated engagement counts', () => {
    const r = unwrapCaption('76K likes, 44 comments - mealprepfeed on May 14, 2024: "Bbq". ');
    expect(r.caption).toBe('Bbq');
    expect(r.author).toBe('mealprepfeed');
  });

  // Unknown shapes degrade to a slightly noisy caption rather than to nothing.
  it('returns the value unchanged when no preamble matches', () => {
    expect(unwrapCaption('just a caption')).toEqual({ caption: 'just a caption' });
  });

  it('keeps caption newlines intact', () => {
    const r = unwrapCaption('user on May 1, 2024: "Title\n\nIngredients:\n- salt". ');
    expect(r.caption).toBe('Title\n\nIngredients:\n- salt');
  });
});

describe('extractCaptionFromHtml', () => {
  it('extracts caption, author, thumbnail and canonical url', () => {
    const r = extractCaptionFromHtml(fixture('reel-likes-prefix.html'));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.caption).toContain('Viral chicken broth pasta');
    expect(r.caption).toContain('datalini pasta');
    // Preamble and trailing quote are gone.
    expect(r.caption).not.toContain('likes,');
    expect(r.caption.endsWith('". ')).toBe(false);
    expect(r.canonicalUrl).toBe('https://www.instagram.com/recipebylayla/reel/C_LYHf-uByQ/');
    expect(r.imageUrl).toMatch(/^https:\/\//);
  });

  it('keeps the multi-line structure the caption parser needs', () => {
    const r = extractCaptionFromHtml(fixture('reel-likes-prefix.html'));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.caption.split('\n').length).toBeGreaterThan(5);
  });

  it('decodes entity-encoded bullets and emoji from the live markup', () => {
    const r = extractCaptionFromHtml(fixture('reel-bare-prefix.html'));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.caption).toContain('•');
    expect(r.caption).not.toContain('&#x2022;');
    expect(r.caption).not.toContain('&quot;');
  });

  it('returns null for a browser-UA shell with no caption meta', () => {
    expect(extractCaptionFromHtml('<html><head><title>Instagram</title></head></html>')).toBeNull();
    expect(extractCaptionFromHtml('')).toBeNull();
  });

  it('ignores a meta tag whose content is empty', () => {
    const html = '<html><head><meta property="og:description" content="" /></head></html>';
    expect(extractCaptionFromHtml(html)).toBeNull();
  });

  it('tolerates reversed attribute order', () => {
    const html =
      '<html><head><meta content="user on May 1, 2024: &quot;Cake&quot;. " property="og:description" /></head></html>';
    expect(extractCaptionFromHtml(html)?.caption).toBe('Cake');
  });

  it('rejects a non-http thumbnail', () => {
    const html =
      '<html><head><meta property="og:description" content="user on May 1, 2024: &quot;Cake&quot;. " />' +
      '<meta property="og:image" content="javascript:alert(1)" /></head></html>';
    expect(extractCaptionFromHtml(html)?.imageUrl).toBeUndefined();
  });
});

// The payoff: extraction feeds the existing caption parser unchanged.
describe('extraction feeding parseRecipeFromCaption', () => {
  it('produces a usable recipe from a real reel', () => {
    const extracted = extractCaptionFromHtml(fixture('reel-likes-prefix.html'));
    expect(extracted).not.toBeNull();
    if (!extracted) return;

    const recipe = parseRecipeFromCaption(extracted.caption, extracted.canonicalUrl);
    expect(recipe.title).toBe('Viral chicken broth pasta // recipe');
    expect(recipe.ingredients.length).toBeGreaterThanOrEqual(5);
    const names = recipe.ingredients.map((i) => i.name);
    expect(names.some((n) => n.includes('pasta'))).toBe(true);
    expect(names.some((n) => n.includes('garlic'))).toBe(true);
  });

  // The deglue payoff. Every one of these arrived as `1 each :: "300g pasta"`
  // before splitGluedUnits, which meant no aggregation and no price.
  it('recovers metric quantities glued to their unit', () => {
    const extracted = extractCaptionFromHtml(fixture('reel-glued-metric.html'));
    expect(extracted).not.toBeNull();
    if (!extracted) return;

    const recipe = parseRecipeFromCaption(extracted.caption, extracted.canonicalUrl);
    const byName = (needle: string) => recipe.ingredients.find((i) => i.name.includes(needle));

    expect(byName('pasta')).toMatchObject({ quantity: 300, unit: 'g' });
    expect(byName('chicken')).toMatchObject({ quantity: 500, unit: 'g' });
    expect(byName('bbq sauce')).toMatchObject({ quantity: 4, unit: 'tbsp' });
    expect(byName('cheese')).toMatchObject({ quantity: 120, unit: 'g' });

    // Nothing should still be carrying a glued quantity in its name.
    for (const ingredient of recipe.ingredients) {
      expect(ingredient.name).not.toMatch(/^\d+\s*(?:g|ml|kg|oz|lb|tbsp|tsp)\b/);
    }
  });

  // Known limitation, asserted so a future change to it is deliberate: this post
  // writes "Chicken - 200-300 grams" (quantity *after* the name). parseIngredient
  // reads left to right, so the quantity is not recovered. Such an item still
  // imports and is editable via the grocery row's pencil icon.
  it('leaves quantity-last lines unquantified (documented limitation)', () => {
    const extracted = extractCaptionFromHtml(fixture('reel-bare-prefix.html'));
    expect(extracted).not.toBeNull();
    if (!extracted) return;

    const recipe = parseRecipeFromCaption(extracted.caption, extracted.canonicalUrl);
    const chicken = recipe.ingredients.find((i) => i.name.includes('chicken'));
    expect(chicken).toBeDefined();
    expect(chicken).toMatchObject({ quantity: 1, unit: 'each' });
  });

  // ~1 in 3 real recipe reels is prose with no ingredient list. That is a normal
  // outcome routed to the editable paste fallback, not a bug.
  it('throws for a prose caption so the caller can fall back to paste', () => {
    const extracted = extractCaptionFromHtml(fixture('reel-prose-caption.html'));
    expect(extracted).not.toBeNull();
    if (!extracted) return;
    expect(extracted.caption.length).toBeGreaterThan(50);
    expect(() => parseRecipeFromCaption(extracted.caption)).toThrow();
  });
});
