// Shared request/response plumbing for the edge functions.
//
// Every function is reachable by anyone holding the app's anon key, which ships
// inside the app bundle and is therefore public. `verify_jwt` on the gateway only
// proves a token was signed by this project — the anon key passes. So each
// function has to decide for itself what an anonymous caller may do, cap what it
// will read, and never echo upstream or runtime error text back out.

/** Largest request body any function accepts. Real payloads are a few hundred bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

export type CallerRole = 'anon' | 'authenticated' | 'service_role' | 'unknown';

/**
 * The role claim of the caller's JWT, WITHOUT re-verifying the signature.
 *
 * Safe only because the gateway runs with verify_jwt = true and rejects any token
 * this project's secret did not sign; what reaches here is authentic, and the
 * claim tells the anon key apart from a signed-in user. Never deploy a function
 * that relies on this with `--no-verify-jwt`.
 */
export function callerRole(req: Request): CallerRole {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return 'unknown';
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const role = typeof payload?.role === 'string' ? payload.role : '';
    if (role === 'anon' || role === 'authenticated' || role === 'service_role') return role;
  } catch {
    // not a JWT we can read
  }
  return 'unknown';
}

export function isSignedIn(req: Request): boolean {
  const role = callerRole(req);
  return role === 'authenticated' || role === 'service_role';
}

/**
 * CORS headers for this request.
 *
 * `ALLOWED_ORIGINS` (comma-separated) restricts browser callers to the web build's
 * origin(s); unset, any origin is allowed, which is the right default for local
 * Expo web development. Native clients send no Origin and are unaffected.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function jsonResponse(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

/**
 * Parse a JSON body, refusing anything over MAX_BODY_BYTES before reading it.
 * Returns null for a missing/oversized/unparseable body.
 */
export async function readJsonBody<T>(req: Request): Promise<T | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await readTextCapped(req, MAX_BODY_BYTES);
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

/**
 * Read a body as text, stopping at `maxBytes`. Returns null when the body is
 * larger than that — a caller must never get a silently truncated document.
 */
export async function readTextCapped(
  source: Request | Response,
  maxBytes: number,
): Promise<string | null> {
  const body = source.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
