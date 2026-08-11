// Classifies whatever the OS share sheet handed us. Instagram shares arrive as a
// URL on iOS, but as `text/plain` on Android — often with the caption or a "Check
// this out" prefix wrapped around the link — so the URL has to be dug out of
// arbitrary text rather than assumed to be the whole payload.
//
// Pure + no I/O, so the routing decision is testable without a native build.

export interface InstagramTarget {
  kind: 'instagram';
  /** Normalized canonical URL, tracking params stripped. */
  url: string;
  /**
   * Post shortcode, when the URL carries one. `/share/…` links are redirects that
   * don't expose it up front — those resolve from og:url after the fetch.
   */
  shortcode: string | null;
}

export interface WebTarget {
  kind: 'web';
  url: string;
}

export interface NoTarget {
  kind: 'none';
}

export type SharedTarget = InstagramTarget | WebTarget | NoTarget;

const URL_RE = /https?:\/\/[^\s<>"'`]+/i;

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);

// Tracking/session junk Instagram appends to shared links. Dropped so the same
// post shared twice produces the same URL.
const STRIP_PARAMS = ['igsh', 'igshid', 'img_index', 'utm_source', 'utm_medium', 'utm_campaign'];

// A shortcode is Instagram's base64-ish id. Length varies (11 is typical, older
// posts differ), so match the character class and a plausible span rather than
// pinning an exact length.
const SHORTCODE = '[A-Za-z0-9_-]{5,24}';

// Path segments Instagram reserves for its own routes. Without this guard,
// "/share/reel/<token>/" reads as username "share" owning a post, and the share
// *token* gets mistaken for a shortcode.
const RESERVED_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'share',
  'explore',
  'stories',
  'accounts',
  'direct',
  'about',
]);

// Two families of post path:
//   /p/<code>/  /reel/<code>/  /reels/<code>/  /tv/<code>/
//   /<username>/p/<code>/      /<username>/reel/<code>/
const POST_PATH_RE = new RegExp(`^/(?:p|reel|reels|tv)/(${SHORTCODE})/?$`, 'i');
const USER_POST_PATH_RE = new RegExp(
  `^/([A-Za-z0-9._]+)/(?:p|reel|reels|tv)/(${SHORTCODE})/?$`,
  'i',
);
// New-style share links, which 302 to the real post. The token is not a shortcode.
const SHARE_PATH_RE = new RegExp(`^/share(?:/(?:p|reel|reels|tv))?/(?:${SHORTCODE})/?$`, 'i');

/** Pull the first http(s) URL out of arbitrary shared text. */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(URL_RE);
  if (!match) return null;
  // Trailing sentence punctuation is not part of the URL.
  return match[0].replace(/[.,;:!?)\]}]+$/, '');
}

function stripTrackingParams(parsed: URL): void {
  for (const param of STRIP_PARAMS) parsed.searchParams.delete(param);
}

/**
 * Classify shared text into an Instagram post, a generic web URL, or nothing.
 * Never throws — unparseable input is `{ kind: 'none' }`.
 */
export function parseSharedUrl(text: string): SharedTarget {
  const raw = extractFirstUrl(typeof text === 'string' ? text.trim() : '');
  if (!raw) return { kind: 'none' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'none' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'none' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return { kind: 'web', url: parsed.toString() };
  }

  stripTrackingParams(parsed);
  const path = parsed.pathname;

  // Share links are checked first: their token sits exactly where a shortcode
  // would, so the post patterns would happily misread it.
  if (SHARE_PATH_RE.test(path)) {
    return { kind: 'instagram', url: parsed.toString(), shortcode: null };
  }

  const direct = path.match(POST_PATH_RE);
  if (direct) {
    return { kind: 'instagram', url: parsed.toString(), shortcode: direct[1] };
  }

  const owned = path.match(USER_POST_PATH_RE);
  if (owned && !RESERVED_SEGMENTS.has(owned[1].toLowerCase())) {
    return { kind: 'instagram', url: parsed.toString(), shortcode: owned[2] };
  }

  // An Instagram link that isn't a single post — a profile, /explore/, a story.
  // There is no caption to read, so don't claim it as an importable target.
  return { kind: 'none' };
}

/** Canonical desktop URL for a shortcode. Used to normalize before fetching. */
export function postUrlFromShortcode(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/`;
}
