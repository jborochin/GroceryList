/**
 * Minimal Kroger Developer API client for the weekly price refresh.
 *
 * Auth is OAuth2 client credentials (no user context) against the public
 * Products and Locations APIs. The token lives ~30 minutes and is cached for
 * the lifetime of the process — one refresh run is well inside that.
 *
 * Rate limit is 10,000 Products calls/day; a full refresh of ~170 ingredients
 * across 3 reference stores costs well under 1,000, so the backoff below exists
 * for transient 5xx/429s rather than for quota management.
 *
 * Prices are location-scoped: the API only returns a price when
 * filter.locationId is supplied. We query a handful of geographically spread
 * reference stores and let the caller take the median, so one store's promo or
 * stockout can't move the national estimate on its own.
 */

const TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token';
const API_BASE = 'https://api.kroger.com/v1';
const SCOPE = 'product.compact';

/**
 * Reference stores the national median is taken across — one per Kroger
 * division/banner, spread over the ~35 states they operate in.
 *
 * These are deliberately committed rather than configured as a secret: they are
 * not sensitive, and which stores compose the median is a substantive choice
 * that should be reviewable and diffable. `KROGER_LOCATION_IDS` overrides them.
 *
 * Cost is ~172 ingredients x (N + 1) calls per run, so 12 stores is ~2,200
 * calls/week against a 10,000/day quota. Adding more is cheap; the reason to
 * stop is diminishing returns on the median, not budget.
 */
export const KROGER_REFERENCE_LOCATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '01400513', label: 'Kroger — Cincinnati, OH' },
  { id: '01100695', label: 'Kroger — Atlanta, GA' },
  { id: '03400355', label: 'Kroger — Houston, TX' },
  { id: '01800443', label: 'Kroger — Detroit, MI' },
  { id: '02900504', label: 'Kroger — Richmond, VA' },
  { id: '70300032', label: 'Ralphs — Los Angeles, CA' },
  { id: '62000115', label: 'King Soopers — Denver, CO' },
  { id: '66000088', label: "Fry's — Phoenix, AZ" },
  { id: '09700205', label: 'Harris Teeter — Charlotte, NC' },
  { id: '70100135', label: 'Fred Meyer — Portland, OR' },
  { id: '70600077', label: "Smith's — Salt Lake City, UT" },
  { id: '70500847', label: 'QFC — Seattle, WA' },
];

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export interface KrogerPrice {
  regular?: number;
  promo?: number;
}

export interface KrogerItem {
  itemId?: string;
  size?: string;
  price?: KrogerPrice;
  nationalPrice?: KrogerPrice;
}

export interface KrogerProduct {
  productId: string;
  upc?: string;
  brand?: string;
  description?: string;
  categories?: string[];
  items?: KrogerItem[];
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface KrogerLocation {
  locationId: string;
  name?: string;
  chain?: string;
  address?: { city?: string; state?: string; zipCode?: string };
}

export class KrogerClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private callCount = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {
    if (!clientId || !clientSecret) {
      throw new Error('KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must both be set.');
    }
  }

  /** Number of API calls made so far — surfaced in the run report to track quota. */
  get calls(): number {
    return this.callCount;
  }

  private async getToken(): Promise<string> {
    // Refresh a minute early so a token can't expire mid-request.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetchWithRetry(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Kroger token request failed (HTTP ${res.status}): ${detail}`);
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token) throw new Error('Kroger token response contained no access_token.');

    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;
    return this.token;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    const url = `${API_BASE}${path}?${new URLSearchParams(params).toString()}`;

    this.callCount += 1;
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Kroger GET ${path} failed (HTTP ${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  /** Search the catalog for an ingredient term at a specific store. */
  async searchProducts(term: string, locationId: string, limit = 10): Promise<KrogerProduct[]> {
    const data = await this.get<{ data?: KrogerProduct[] }>('/products', {
      'filter.term': term,
      'filter.locationId': locationId,
      'filter.limit': String(limit),
    });
    return data.data ?? [];
  }

  /**
   * Fetch one pinned product at a store. Returns null on 404 rather than
   * throwing, so a single discontinued SKU degrades to "unresolved" instead of
   * failing the whole run.
   */
  async getProduct(productId: string, locationId: string): Promise<KrogerProduct | null> {
    try {
      const data = await this.get<{ data?: KrogerProduct }>(`/products/${productId}`, {
        'filter.locationId': locationId,
      });
      return data.data ?? null;
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
      throw err;
    }
  }

  /** Find store IDs near a ZIP — used by `npm run prices:find-locations` during setup. */
  async findLocations(zipCode: string, limit = 5): Promise<KrogerLocation[]> {
    const data = await this.get<{ data?: KrogerLocation[] }>('/locations', {
      'filter.zipCode.near': zipCode,
      'filter.limit': String(limit),
    });
    return data.data ?? [];
  }
}

/**
 * Pull the best available price out of a product for one store.
 *
 * Prefers `nationalPrice` when the response carries it — that is exactly the
 * national average we want and needs no cross-store smoothing. Falls back to
 * the store's own regular price. Deliberately ignores `promo`: a temporary sale
 * is not what a weekly grocery estimate should be anchored to.
 */
export function extractPrice(product: KrogerProduct): { price: number; size: string } | null {
  const item = product.items?.[0];
  if (!item) return null;

  const price = item.nationalPrice?.regular ?? item.price?.regular;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (!item.size) return null;

  return { price, size: item.size };
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // Retry transient failures only; 4xx (other than 429) won't fix itself.
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Kroger request failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
