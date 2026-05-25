// Supabase Edge Function: fetch-recipe
// Fetches an arbitrary recipe URL server-side so the web client can bypass CORS.
// Native (iOS/Android) clients do not call this function — they fetch directly.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

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

const FETCH_TIMEOUT_MS = 15_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

type ValidationResult = { url: URL } | { error: string };

function validateUrl(input: unknown): ValidationResult {
  if (typeof input !== 'string' || !input.trim()) return { error: 'url is required' };
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { error: 'url is malformed' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'only http(s) urls are allowed' };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { error: 'hostname is not allowed' };
  }
  return { url: parsed };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, kind: 'method-not-allowed' });
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(200, { ok: false, kind: 'bad-request', message: 'invalid json body' });
  }

  const validated = validateUrl(body.url);
  if ('error' in validated) {
    return json(200, { ok: false, kind: 'bad-request', message: validated.error });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const direct = await fetchDirect(validated.url.toString(), controller.signal);
    if (direct.ok) {
      return json(200, { ok: true, html: direct.html, status: direct.status, finalUrl: direct.finalUrl });
    }
    // Bot-protected sites (Cloudflare/Akamai) typically return 403/429/503 to
    // datacenter IPs even with a real-browser header set. Fall back to the most
    // recent Wayback Machine snapshot, which usually has the recipe JSON-LD intact.
    if (isBlockedStatus(direct.status)) {
      const archived = await fetchViaWayback(validated.url.toString(), controller.signal);
      if (archived) {
        return json(200, { ok: true, html: archived.html, status: 200, finalUrl: archived.finalUrl, viaWayback: true });
      }
      // Third-tier fallback for never-archived URLs: a residential-IP scraping
      // service. Gated on SCRAPINGBEE_API_KEY so dev/test environments without
      // the secret keep the original failure mode instead of erroring out.
      const scraped = await fetchViaScrapingBee(validated.url.toString(), controller.signal);
      if (scraped) {
        return json(200, { ok: true, html: scraped.html, status: 200, finalUrl: scraped.finalUrl, viaScrapingBee: true });
      }
    }
    return json(200, {
      ok: false,
      kind: 'upstream',
      status: direct.status,
      message: `HTTP ${direct.status}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    if (err instanceof DOMException && err.name === 'AbortError') {
      return json(200, { ok: false, kind: 'timeout', message: 'fetch timed out' });
    }
    return json(200, { ok: false, kind: 'network', message });
  } finally {
    clearTimeout(timer);
  }
});

type DirectFetch =
  | { ok: true; html: string; status: number; finalUrl: string }
  | { ok: false; status: number };

async function fetchDirect(url: string, signal: AbortSignal): Promise<DirectFetch> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal,
    redirect: 'follow',
  });
  if (!res.ok) {
    // Drain body so the connection can be reused / closed cleanly.
    try { await res.arrayBuffer(); } catch { /* ignore */ }
    return { ok: false, status: res.status };
  }
  return { ok: true, html: await res.text(), status: res.status, finalUrl: res.url };
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
  const rawUrl = `https://web.archive.org/web/${closest.timestamp}id_/${originalUrl}`;
  let rawRes: Response;
  try {
    rawRes = await fetch(rawUrl, { signal, redirect: 'follow' });
  } catch {
    return null;
  }
  if (!rawRes.ok) return null;
  return { html: await rawRes.text(), finalUrl: rawRes.url };
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
    try { await res.arrayBuffer(); } catch { /* ignore */ }
    return null;
  }
  return { html: await res.text(), finalUrl: originalUrl };
}
