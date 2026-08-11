import { importInstagramRecipe, InstagramImportError } from '../utils/instagramImport';
import { RecipeParseError } from '../utils/recipeUrlParser';

// The fetch itself is network I/O and stays out of the suite (probe it with
// `npm run ig:probe`). What is worth pinning down here is the guard that runs
// before any request, and the error contract the screen depends on.

describe('InstagramImportError', () => {
  it('is a RecipeParseError so existing error handling still matches', () => {
    const err = new InstagramImportError('malformed', 'nope');
    expect(err).toBeInstanceOf(RecipeParseError);
    expect(err.kind).toBe('malformed');
  });

  it('carries the recovered caption for the paste fallback', () => {
    const err = new InstagramImportError('not-found', 'nope', 'Some caption text');
    expect(err.recoveredCaption).toBe('Some caption text');
  });

  it('leaves recoveredCaption undefined when nothing was recovered', () => {
    expect(new InstagramImportError('network', 'offline').recoveredCaption).toBeUndefined();
  });
});

describe('importInstagramRecipe url guard', () => {
  // Rejected before any fetch, so these assertions touch no network.
  it.each([
    'https://www.budgetbytes.com/marry-me-chicken-pasta/',
    'https://www.instagram.com/recipebylayla/',
    'not a url at all',
    '',
  ])('rejects %s without attempting a fetch', async (url) => {
    await expect(importInstagramRecipe(url)).rejects.toThrow(InstagramImportError);
    await expect(importInstagramRecipe(url)).rejects.toThrow(/not an Instagram post or reel/i);
  });
});
