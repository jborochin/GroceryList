import {
  coverImageUrlFromShortcode,
  extractFirstUrl,
  parseSharedUrl,
  postUrlFromShortcode,
} from '../utils/instagramUrl';

describe('extractFirstUrl', () => {
  it('returns a bare url unchanged', () => {
    expect(extractFirstUrl('https://www.instagram.com/reel/ABC123defg/')).toBe(
      'https://www.instagram.com/reel/ABC123defg/',
    );
  });

  // Android hands share targets `text/plain`, frequently with prose wrapped around
  // the link, so the URL has to be dug out rather than assumed.
  it('digs a url out of surrounding shared text', () => {
    expect(
      extractFirstUrl('Check this out https://www.instagram.com/reel/ABC123defg/ so good'),
    ).toBe('https://www.instagram.com/reel/ABC123defg/');
  });

  it('drops trailing sentence punctuation', () => {
    expect(extractFirstUrl('see https://example.com/recipe.')).toBe('https://example.com/recipe');
  });

  it('returns null when there is no url', () => {
    expect(extractFirstUrl('just some text')).toBeNull();
    expect(extractFirstUrl('')).toBeNull();
  });
});

describe('parseSharedUrl', () => {
  it.each([
    ['https://www.instagram.com/p/C6IsG9BI3WZ/', 'C6IsG9BI3WZ'],
    ['https://www.instagram.com/reel/C_LYHf-uByQ/', 'C_LYHf-uByQ'],
    ['https://www.instagram.com/reels/C_LYHf-uByQ/', 'C_LYHf-uByQ'],
    ['https://www.instagram.com/tv/C_LYHf-uByQ/', 'C_LYHf-uByQ'],
    ['https://www.instagram.com/thecheeseball_/reel/C6IsG9BI3WZ/', 'C6IsG9BI3WZ'],
    ['https://www.instagram.com/recipe.by.layla/p/C6IsG9BI3WZ/', 'C6IsG9BI3WZ'],
    ['https://instagram.com/reel/C_LYHf-uByQ', 'C_LYHf-uByQ'],
    ['https://instagr.am/p/C6IsG9BI3WZ/', 'C6IsG9BI3WZ'],
  ])('recognizes %s', (url, shortcode) => {
    expect(parseSharedUrl(url)).toEqual({
      kind: 'instagram',
      url: expect.any(String),
      shortcode,
    });
  });

  it('strips igsh tracking params that Instagram appends to shares', () => {
    const r = parseSharedUrl('https://www.instagram.com/reel/C_LYHf-uByQ/?igsh=MzRlODBiNWFlZA==');
    expect(r.kind).toBe('instagram');
    if (r.kind !== 'instagram') return;
    expect(r.url).not.toContain('igsh');
    expect(r.shortcode).toBe('C_LYHf-uByQ');
  });

  // /share/ links are redirects: the real shortcode only appears in og:url after
  // the fetch, so a null shortcode here is expected, not a failure.
  it('accepts /share/ redirect links without a shortcode', () => {
    expect(parseSharedUrl('https://www.instagram.com/share/reel/_pMnwEXaM/')).toEqual({
      kind: 'instagram',
      url: 'https://www.instagram.com/share/reel/_pMnwEXaM/',
      shortcode: null,
    });
  });

  it('routes a non-Instagram url to the generic web importer', () => {
    expect(parseSharedUrl('https://www.budgetbytes.com/marry-me-chicken-pasta/')).toEqual({
      kind: 'web',
      url: 'https://www.budgetbytes.com/marry-me-chicken-pasta/',
    });
  });

  // An Instagram link with no single post behind it has no caption to read, so it
  // must not be claimed as importable.
  it.each([
    'https://www.instagram.com/recipebylayla/',
    'https://www.instagram.com/explore/tags/pasta/',
    'https://www.instagram.com/stories/recipebylayla/123456/',
  ])('rejects non-post Instagram url %s', (url) => {
    expect(parseSharedUrl(url)).toEqual({ kind: 'none' });
  });

  it.each(['', 'no url at all', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'returns none for %s',
    (input) => {
      expect(parseSharedUrl(input)).toEqual({ kind: 'none' });
    },
  );
});

describe('postUrlFromShortcode', () => {
  it('builds a canonical post url', () => {
    expect(postUrlFromShortcode('C6IsG9BI3WZ')).toBe('https://www.instagram.com/p/C6IsG9BI3WZ/');
  });
});

describe('coverImageUrlFromShortcode', () => {
  // The /p/ form is not cosmetic: /reel/<code>/media/ 404s.
  it('builds a /p/ media url', () => {
    expect(coverImageUrlFromShortcode('C6IsG9BI3WZ')).toBe(
      'https://www.instagram.com/p/C6IsG9BI3WZ/media/?size=l',
    );
  });

  // A /share/… link hides its shortcode, so the importer re-derives one from
  // og:url. That only works if the username-owned form round-trips.
  it.each([
    'https://www.instagram.com/recipebylayla/reel/C_LYHf-uByQ/',
    'https://www.instagram.com/jalalsamfit/reel/DbgHTSuCvk8/',
    'https://www.instagram.com/p/DbgHTSuCvk8/',
  ])('recovers a shortcode from canonical url %s', (canonical) => {
    const target = parseSharedUrl(canonical);
    expect(target.kind).toBe('instagram');
    if (target.kind !== 'instagram' || !target.shortcode) throw new Error('no shortcode');
    expect(coverImageUrlFromShortcode(target.shortcode)).toMatch(
      /^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/media\/\?size=l$/,
    );
  });
});
