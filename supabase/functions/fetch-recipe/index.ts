// Supabase Edge Function: fetch-recipe
// Fetches an arbitrary recipe URL server-side so the web client can bypass CORS.
// Native (iOS/Android) clients do not call this function — they fetch directly.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    const res = await fetch(validated.url.toString(), {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return json(200, {
        ok: false,
        kind: 'upstream',
        status: res.status,
        message: `HTTP ${res.status}`,
      });
    }
    const html = await res.text();
    return json(200, { ok: true, html, status: res.status, finalUrl: res.url });
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
