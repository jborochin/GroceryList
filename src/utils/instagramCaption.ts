import { sanitizeImageUrl } from './recipeUrlParser';

// Instagram renders posts client-side: a normal browser request returns a ~600KB
// JavaScript shell with no caption and no og tags at all. Requested with a crawler
// User-Agent, though, the same URL serves the *complete* caption in its meta tags
// (see INSTAGRAM_HEADERS in instagramImport.ts — the UA is required, not an
// optimization). The `/embed/captioned/` endpoint that older scrapers used is dead;
// it now returns the same shell for every shortcode.
//
// Two properties of that markup matter downstream:
//   1. Real newlines survive inside the attribute value, which is what makes the
//      line-based parseRecipeFromCaption viable at all.
//   2. Emoji, bullets and quotes arrive HTML-entity-encoded (&#x2022;, &quot;).
//
// This module is pure so the whole extraction is testable off small fixtures.

export interface ExtractedCaption {
  caption: string;
  imageUrl?: string;
  canonicalUrl?: string;
  author?: string;
}

/**
 * Read a meta tag's content by property/name, tolerating either attribute order.
 * `[^"]*` deliberately matches newlines — the caption depends on it.
 */
function readMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The gaps between "<meta" and each attribute are bounded. Unbounded, every
  // "<meta" in a hostile page starts a scan to end-of-input (quadratic); the
  // content capture itself stays unbounded because a full caption is long.
  const patterns = [
    new RegExp(`<meta[^>]{1,512}(?:property|name)=["']${escaped}["'][^>]{0,512}\\bcontent=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]{1,512}\\bcontent=["']([^"']*)["'][^>]{0,512}(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

/**
 * Decode HTML entities in one pass. A single pass matters: decoding `&amp;` in a
 * separate step would turn a literal `&amp;#x27;` into `'`.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const token = body.toLowerCase();
    if (token.startsWith('#x')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? safeCodePoint(code) : whole;
    }
    if (token.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? safeCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[token] ?? whole;
  });
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

// Instagram wraps the caption in an attribution preamble, in three observed shapes:
//   "687 likes, 31 comments - recipebylayla on August 27, 2024: \"…\". "
//   "thecheeseball_ on April 24, 2024: \"…\". "
//   "Recipe Developer | UAE 🇦🇪 on Instagram: \"…\". "   (og:title form)
// The engagement counts are optional and the date may be a literal "Instagram".
const PREAMBLE_RE =
  /^(?:[\d.,]+[KMkm]?\s+likes?,\s*[\d.,]+[KMkm]?\s+comments?\s+-\s+)?(.{1,120}?)\s+on\s+(?:Instagram|[A-Z][a-z]+\s+\d{1,2},\s*\d{4})\s*:\s*"([\s\S]*)$/;

interface Unwrapped {
  caption: string;
  author?: string;
}

/**
 * Strip Instagram's attribution preamble and trailing `". ` from a meta value.
 * Returns the text unchanged when it doesn't match a known shape, so an
 * unrecognized format degrades to "slightly noisy caption" rather than nothing.
 */
export function unwrapCaption(value: string): Unwrapped {
  const m = value.match(PREAMBLE_RE);
  if (!m) return { caption: value.trim() };
  const author = m[1].trim();
  const caption = m[2].replace(/"\s*\.?\s*$/, '').trim();
  return { caption, author: author || undefined };
}

/**
 * Pull the caption (plus thumbnail and canonical URL) out of an Instagram post
 * page fetched with a crawler UA. Returns null when no caption-bearing meta tag
 * is present — a login wall, a deleted post, or a plain browser-UA response.
 */
export function extractCaptionFromHtml(html: string): ExtractedCaption | null {
  if (!html) return null;

  // og:description and meta[name=description] were byte-identical in every sample
  // and both ran longer than og:title, but not universally — take whichever
  // decodes longest rather than trusting one tag.
  const candidates = ['og:description', 'description', 'og:title']
    .map((key) => readMeta(html, key))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => unwrapCaption(decodeHtmlEntities(v)));

  const best = candidates.reduce<Unwrapped | null>(
    (acc, cur) => (acc === null || cur.caption.length > acc.caption.length ? cur : acc),
    null,
  );
  if (!best || !best.caption) return null;

  const rawImage = readMeta(html, 'og:image');
  const rawCanonical = readMeta(html, 'og:url');

  return {
    caption: best.caption,
    author: best.author,
    // Untrusted remote markup — same guard the JSON-LD importer uses.
    imageUrl: sanitizeImageUrl(rawImage ? decodeHtmlEntities(rawImage) : undefined),
    // Also untrusted, and it becomes the recipe's sourceUrl, which the detail
    // screen hands to Linking.openURL — so http(s) only, same as the image.
    canonicalUrl: sanitizeImageUrl(rawCanonical ? decodeHtmlEntities(rawCanonical) : undefined),
  };
}
