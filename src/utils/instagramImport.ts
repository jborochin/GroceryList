import { ParsedRecipe, RecipeParseError, RecipeParseErrorKind } from './recipeUrlParser';
import { extractCaptionFromHtml } from './instagramCaption';
import { parseRecipeFromCaption } from './instagramCaptionParser';
import { parseSharedUrl } from './instagramUrl';

// Instagram serves a ~600KB client-rendered shell to anything that looks like a
// browser. Asked as a link-preview crawler, the same URL returns the complete
// caption in its meta tags. This UA is load-bearing, not an optimization — see
// instagramCaption.ts. Kept in sync with CRAWLER_HEADERS in
// supabase/functions/fetch-recipe/index.ts.
const INSTAGRAM_HEADERS: Record<string, string> = {
  'User-Agent': 'facebookexternalhit/1.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 15000;

function isWebRuntime(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/**
 * Raised when the caption was recovered but no recipe could be read out of it.
 *
 * Extends RecipeParseError so existing `instanceof` handling keeps working, and
 * carries the caption so the screen can drop the user into the editable paste box
 * with the text already there instead of making them start over. Roughly one in
 * three real recipe reels is prose with no ingredient list, so this is a routine
 * outcome rather than an exceptional one.
 */
export class InstagramImportError extends RecipeParseError {
  readonly recoveredCaption?: string;

  constructor(kind: RecipeParseErrorKind, message: string, recoveredCaption?: string) {
    super(kind, message);
    this.recoveredCaption = recoveredCaption;
  }
}

async function fetchInstagramHtml(url: string): Promise<string> {
  if (isWebRuntime()) return fetchViaProxy(url);
  return fetchDirect(url);
}

async function fetchDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: INSTAGRAM_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new InstagramImportError('network', `Instagram returned HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof RecipeParseError) throw err;
    const message = err instanceof Error ? err.message : 'Fetch failed';
    throw new InstagramImportError('network', message);
  } finally {
    clearTimeout(timer);
  }
}

interface ProxyResponse {
  ok: boolean;
  html?: string;
  kind?: string;
  message?: string;
}

// Browsers cannot read instagram.com cross-origin, so the web build goes through
// the same edge function the URL importer uses, with the crawler preset.
async function fetchViaProxy(url: string): Promise<string> {
  const { getSupabase, supabaseConfigured } = await import('../lib/supabase');
  if (!supabaseConfigured) {
    throw new InstagramImportError(
      'cors',
      'Importing from Instagram in a browser needs the Supabase proxy configured.',
    );
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke<ProxyResponse>('fetch-recipe', {
    body: { url, preset: 'instagram' },
  });
  if (error || !data) {
    throw new InstagramImportError('network', error?.message || 'Proxy request failed');
  }
  if (!data.ok || typeof data.html !== 'string') {
    throw new InstagramImportError('network', data.message || 'Proxy returned no html');
  }
  return data.html;
}

/**
 * Fetch an Instagram reel or post and turn its caption into a reviewable recipe.
 *
 * Throws InstagramImportError; when the caption was readable but unparseable, the
 * error carries `recoveredCaption` for the paste fallback.
 */
export async function importInstagramRecipe(url: string): Promise<ParsedRecipe> {
  const target = parseSharedUrl(url);
  if (target.kind !== 'instagram') {
    throw new InstagramImportError(
      'not-found',
      'That link is not an Instagram post or reel.',
    );
  }

  const html = await fetchInstagramHtml(target.url);
  const extracted = extractCaptionFromHtml(html);
  if (!extracted) {
    // Either a login/age wall, a deleted post, or Instagram stopped serving meta
    // tags to crawlers. Indistinguishable from here, and the fix is the same.
    throw new InstagramImportError(
      'not-found',
      "Couldn't read this post's caption. It may be private, deleted, or age-restricted.",
    );
  }

  const sourceUrl = extracted.canonicalUrl ?? target.url;
  try {
    const parsed = parseRecipeFromCaption(extracted.caption, sourceUrl);
    return {
      ...parsed,
      // The reel thumbnail is a better recipe image than nothing, and the caption
      // parser never supplies one.
      imageUrl: parsed.imageUrl ?? extracted.imageUrl,
    };
  } catch (err) {
    const kind: RecipeParseErrorKind = err instanceof RecipeParseError ? err.kind : 'malformed';
    const message =
      err instanceof Error ? err.message : 'The caption could not be read as a recipe.';
    throw new InstagramImportError(kind, message, extracted.caption);
  }
}
