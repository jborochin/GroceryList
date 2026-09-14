// SSRF guard for server-side fetches of caller-supplied URLs.
//
// Pure and runtime-agnostic (no Deno globals), so the Jest suite can import it
// directly: src/__tests__/urlGuard.test.ts. Keep it that way.
//
// Two rules, both load-bearing:
//   1. Validate the WHATWG-canonical hostname. `new URL()` rewrites every numeric
//      IPv4 spelling (2130706433, 0x7f.1, 0177.0.0.1) to dotted-quad and every
//      IPv6 address to compressed lowercase hex (so ::ffff:127.0.0.1 becomes
//      ::ffff:7f00:1), which is why the checks below read those canonical forms.
//   2. Validate EVERY hop. Checking only the first URL and then fetching with
//      `redirect: 'follow'` lets any public host 302 the function into
//      169.254.169.254 or an internal service.
//
// Known residual: a public hostname whose DNS resolves to a private address
// passes the string check. Supabase Edge Functions run on Deno Deploy, which
// does not route to the project's private network or to a metadata endpoint, so
// this is accepted rather than paying a DNS resolve per request.

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && (b === 168 || b === 0)) return true; // private, IETF 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIpv6(h: string): boolean {
  if (h === '::1' || h === '::') return true;
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    return isPrivateIpv4(hi >> 8, hi & 0xff);
  }
  const first = parseInt(h.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Expects `URL.hostname` — i.e. already canonicalized, IPv6 still in brackets. */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (h.startsWith('[') && h.endsWith(']')) return isPrivateIpv6(h.slice(1, -1));
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return isPrivateIpv4(parseInt(ipv4[1], 10), parseInt(ipv4[2], 10));
  return false;
}

export type UrlValidation = { url: URL } | { error: string };

export function validateFetchUrl(input: unknown): UrlValidation {
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
  if (parsed.username || parsed.password) return { error: 'credentials in url are not allowed' };
  if (isPrivateHostname(parsed.hostname)) return { error: 'hostname is not allowed' };
  return { url: parsed };
}

export type SafeFetchResult =
  | { kind: 'response'; response: Response; url: string }
  | { kind: 'blocked-redirect'; status: number }
  | { kind: 'bad-redirect'; status: number }
  | { kind: 'too-many-redirects'; status: number };

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Fetch `start`, following redirects by hand and re-validating each Location.
 * Any non-3xx response is returned as-is for the caller to read. A redirect into
 * a private address is refused without ever being requested.
 */
export async function fetchFollowingSafeRedirects(
  start: URL,
  init: RequestInit,
  fetchImpl: FetchImpl = (url, i) => fetch(url, i),
  maxRedirects = 3,
): Promise<SafeFetchResult> {
  let current = start;
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(current.toString(), { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) {
      return { kind: 'response', response, url: current.toString() };
    }
    // Drain so the connection can be reused / closed cleanly.
    await response.arrayBuffer().catch(() => undefined);
    if (hop >= maxRedirects) return { kind: 'too-many-redirects', status: response.status };
    const location = response.headers.get('location');
    if (!location) return { kind: 'bad-redirect', status: response.status };
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { kind: 'bad-redirect', status: response.status };
    }
    const check = validateFetchUrl(next.toString());
    if ('error' in check) {
      return check.error === 'hostname is not allowed' || check.error.startsWith('only http')
        ? { kind: 'blocked-redirect', status: response.status }
        : { kind: 'bad-redirect', status: response.status };
    }
    current = check.url;
  }
}
