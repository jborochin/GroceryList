// Supabase Edge Function: fetch-recipe
// Fetches an arbitrary recipe URL server-side so the web client can bypass CORS.
// Native (iOS/Android) clients do not call this function — they fetch directly.
//
// This is an open fetch proxy reachable with the public anon key, so it is the
// most exposed thing in the project. Three guards, all load-bearing:
//   1. Every hop is validated, not just the first URL. `redirect: 'follow'` let a
//      public host 302 the function into 169.254.169.254 or an internal service
//      and hand the body back to the caller.
//   2. Bodies are capped (request and upstream), and only HTML-ish content types
//      are read at all.
//   3. The paid residential-proxy tier (ScrapingBee) is only reachable by a
//      signed-in user, never by the bare anon key.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, isSignedIn, jsonResponse, readJsonBody, readTextCapped } from '../_shared/http.ts';
import { fetchFollowingSafeRedirects, validateFetchUrl as validateUrl } from '../_shared/urlGuard.ts';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Many recipe sites (allrecipes.com et al.) sit behind Cloudflare / Akamai bot
// detection that 403s requests with a sparse header set. Sending the same header
// shape a real Chrome request would send is enough to clear most gates.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

// Instagram renders posts client-side and serves a ~600KB JavaScript shell to
// anything that looks like a browser — BROWSER_HEADERS above gets *no* caption and
// no og tags at all. Requested as a link-preview crawler, the same URL returns the
// full caption in its meta tags. Selected by `preset: 'instagram'` in the body;
// callers that send no preset keep the browser header set unchanged.
// Kept in sync with INSTAGRAM_HEADERS in src/utils/instagramImport.ts.
const CRAWLER_HEADERS: Record<string, string> = {
  'User-Agent': 'facebookexternalhit/1.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const HEADER_PRESETS: Record<string, Record<string, string>> = {
  browser: BROWSER_HEADERS,
  instagram: CRAWLER_HEADERS,
};

const FETCH_TIMEOUT_MS = 15_000;
/** Largest upstream document read. Recipe pages are well under 1 MB; Instagram's shell ~600 KB. */
const MAX_HTML_BYTES = 5 * 1024 * 1024;

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, 405, { ok: false, kind: 'method-not-allowed' });
  }

  const body = await readJsonBody<{ url?: unknown; preset?: unknown }>(req);
  if (!body) {
    return jsonResponse(req, 200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  // Unknown or absent preset falls back to the browser headers, so existing
  // callers are unaffected.
  const headers =
    (typeof body.preset === 'string' ? HEADER_PRESETS[body.preset] : undefined) ?? BROWSER_HEADERS;

  const validated = validateUrl(body.url);
  if ('error' in validated) {
    return jsonResponse(req, 200, { ok: false, kind: 'bad-request', message: validated.error });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const direct = await fetchDirect(validated.url, controller.signal, headers);
    if (direct.ok) {
      return jsonResponse(req, 200, { ok: true, html: direct.html, status: direct.status, finalUrl: direct.finalUrl });
    }
    if (direct.kind === 'blocked-redirect') {
      return jsonResponse(req, 200, { ok: false, kind: 'bad-request', message: 'hostname is not allowed' });
    }
    if (direct.kind === 'too-large' || direct.kind === 'not-html') {
      return jsonResponse(req, 200, { ok: false, kind: 'upstream', message: 'unsupported document' });
    }
    // Bot-protected sites (Cloudflare/Akamai) typically return 403/429/503 to
    // datacenter IPs even with a real-browser header set. Fall back to the most
    // recent Wayback Machine snapshot, which usually has the recipe JSON-LD intact.
    if (isBlockedStatus(direct.status)) {
      const archived = await fetchViaWayback(validated.url.toString(), controller.signal);
      if (archived) {
        return jsonResponse(req, 200, { ok: true, html: archived.html, status: 200, finalUrl: archived.finalUrl, viaWayback: true });
      }
      // Third-tier fallback for never-archived URLs: a residential-IP scraping
      // service. Gated on SCRAPINGBEE_API_KEY so dev/test environments without
      // the secret keep the original failure mode, and on a signed-in caller so
      // the public anon key cannot spend credits.
      if (isSignedIn(req)) {
        const scraped = await fetchViaScrapingBee(validated.url.toString(), controller.signal);
        if (scraped) {
          return jsonResponse(req, 200, { ok: true, html: scraped.html, status: 200, finalUrl: scraped.finalUrl, viaScrapingBee: true });
        }
      }
    }
    return jsonResponse(req, 200, {
      ok: false,
      kind: 'upstream',
      status: direct.status,
      message: `HTTP ${direct.status}`,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return jsonResponse(req, 200, { ok: false, kind: 'timeout', message: 'fetch timed out' });
    }
    // Runtime error text can carry the URL and internals; log it, don't return it.
    console.error('fetch-recipe failed', err instanceof Error ? err.message : err);
    return jsonResponse(req, 200, { ok: false, kind: 'network', message: 'fetch failed' });
  } finally {
    clearTimeout(timer);
  }
});

type DirectFetch =
  | { ok: true; html: string; status: number; finalUrl: string }
  | { ok: false; status: number; kind: 'http' | 'blocked-redirect' | 'too-large' | 'not-html' };

function isHtmlContentType(value: string | null): boolean {
  if (!value) return true; // some hosts omit it; the parser copes with non-HTML
  const type = value.split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml' || type === 'text/plain';
}

/**
 * Fetch with every redirect hop re-validated (see _shared/urlGuard.ts). A redirect
 * into a private range is reported as `blocked-redirect` without being requested;
 * the caller turns that into the same error the initial check gives.
 */
async function fetchDirect(
  start: URL,
  signal: AbortSignal,
  headers: Record<string, string> = BROWSER_HEADERS,
): Promise<DirectFetch> {
  const result = await fetchFollowingSafeRedirects(start, { headers, signal });
  if (result.kind === 'blocked-redirect') return { ok: false, status: result.status, kind: 'blocked-redirect' };
  if (result.kind !== 'response') return { ok: false, status: result.status, kind: 'http' };
  const res = result.response;
  if (!res.ok) {
    // Drain body so the connection can be reused / closed cleanly.
    await res.arrayBuffer().catch(() => undefined);
    return { ok: false, status: res.status, kind: 'http' };
  }
  if (!isHtmlContentType(res.headers.get('content-type'))) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, kind: 'not-html' };
  }
  const html = await readTextCapped(res, MAX_HTML_BYTES);
  if (html === null) return { ok: false, status: res.status, kind: 'too-large' };
  return { ok: true, html, status: res.status, finalUrl: result.url };
}

function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 503;
}

async function fetchViaWayback(
  originalUrl: string,
  signal: AbortSignal,
): Promise<{ html: string; finalUrl: string } | null> {
  // 1) Ask the availability API for the closest snapshot.
  const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
  let availRes: Response;
  try {
    availRes = await fetch(availUrl, { signal });
  } catch {
    return null;
  }
  if (!availRes.ok) return null;
  let avail: { archived_snapshots?: { closest?: { available?: boolean; timestamp?: string; status?: string } } };
  try {
    avail = await availRes.json();
  } catch {
    return null;
  }
  const closest = avail.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) return null;
  // 2) The `id_` modifier returns the raw archived HTML without the Wayback toolbar
  // injection, which keeps JSON-LD blocks byte-identical to the original page.
  // Wayback's own redirects stay on web.archive.org, so following them is safe.
  const rawUrl = `https://web.archive.org/web/${closest.timestamp}id_/${originalUrl}`;
  let rawRes: Response;
  try {
    rawRes = await fetch(rawUrl, { signal, redirect: 'follow' });
  } catch {
    return null;
  }
  if (!rawRes.ok || !rawRes.url.startsWith('https://web.archive.org/')) return null;
  const html = await readTextCapped(rawRes, MAX_HTML_BYTES);
  return html === null ? null : { html, finalUrl: rawRes.url };
}

async function fetchViaScrapingBee(
  originalUrl: string,
  signal: AbortSignal,
): Promise<{ html: string; finalUrl: string } | null> {
  const apiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  if (!apiKey) return null;
  // premium_proxy routes through residential IPs (25 credits/req) which gets
  // past Cloudflare's datacenter-IP block. render_js=false because recipe
  // sites embed JSON-LD in the initial HTML, so we save the ~4x JS-render cost.
  const params = new URLSearchParams({
    api_key: apiKey,
    url: originalUrl,
    premium_proxy: 'true',
    render_js: 'false',
  });
  const endpoint = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(endpoint, { signal });
  } catch {
    return null;
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    return null;
  }
  const html = await readTextCapped(res, MAX_HTML_BYTES);
  return html === null ? null : { html, finalUrl: originalUrl };
}
