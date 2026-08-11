/**
 * Resolve one ingredient to a live retail price.
 *
 * This is the shared core of every path that turns an ingredient name into a Kroger
 * price: the weekly top-up (scripts/refreshKrogerPrices.ts), the catalog bootstrap
 * (scripts/prices/bootstrap.ts), and the on-demand edge function. Keeping one
 * implementation matters because the gates below are the only thing standing between a
 * plausible-looking retail SKU and a wrong price shipped to every device.
 *
 * DENO PORTABILITY. This module deliberately imports nothing that reaches the app's
 * runtime: no JSON, no fuse.js, no React Native. The purchase profile is INJECTED by the
 * caller rather than looked up here, because the obvious implementation —
 * `getProfile(name)` from src/utils/purchaseProfile — calls findPrice, which imports
 * fuse.js and the bundled catalog. Node callers pass `getProfile(name)`; the edge
 * function passes a default derived from the baseline unit it already holds.
 *
 * REJECTION IS SAFE. Every failure path returns a `rejected:*` status rather than
 * throwing. A rejected ingredient keeps its previously published price, or falls through
 * to the bundled hand-estimate — which is the app's behavior without live pricing at
 * all. Nothing breaks when a match fails, so the gates can afford to be strict.
 */
import { KrogerClient, KrogerProduct, extractPrice } from './krogerClient';
import {
  MIN_CONFIDENCE,
  descriptionSpecificity,
  median,
  parseSize,
  pickMedianBy,
  sanityBand,
  scoreMatch,
} from './krogerMatch';

/**
 * How a store sells an ingredient. Structurally identical to `PurchaseProfile` in
 * src/utils/purchaseProfile.ts, redeclared here so this module stays free of app imports.
 */
export interface ResolveProfile {
  sellUnit: string;
  packSize: number;
  grams?: Record<string, number>;
}

/** Candidate pool per ingredient. Wide enough to span the store-brand-to-premium
 *  spread so the median is meaningful, narrow enough to stay relevant. */
export const DEFAULT_SEARCH_LIMIT = 12;

export interface ResolveInput {
  normalizedName: string;
  searchTerm: string;
  reviewed: boolean;
  /** Pinned SKU from a previous run. Only honored when `reviewed`. */
  krogerProductId: string | null;
  /**
   * Bundled hand-estimate the sanity band compares candidates against.
   *
   * `null` means "no baseline exists yet" — the bootstrap case, where we are resolving
   * an ingredient precisely BECAUSE it has no price. The band is skipped rather than
   * approximated, and the caller is expected to put the result in front of a human
   * instead of publishing it. See scripts/prices/bootstrap.ts.
   */
  baselinePricePerUnit: number | null;
  baselineUnit: string;
}

export interface ResolveOptions {
  /**
   * Purchase profile for the ingredient, used to convert a SKU's pack size into the
   * baseline unit. Omit to use `{ sellUnit: baselineUnit, packSize: 1 }`, which is the
   * same default `getProfile()` derives for an ingredient with no explicit entry.
   */
  profile?: ResolveProfile;
  searchLimit?: number;
  /** Convert a measure across unit families. Injected so this module needn't import the app's. */
  convertMeasure: ConvertMeasure;
}

export type ConvertMeasure = (
  qty: number,
  from: string,
  to: string,
  profile: ResolveProfile | null
) => number | null;

export type ResolveStatus = 'published' | `rejected:${string}` | 'unresolved';

export interface Resolution {
  normalizedName: string;
  searchTerm: string;
  reviewed: boolean;
  /** Had no pinned product id before this run. */
  wasEnrolled: boolean;
  productId?: string;
  description?: string;
  size?: string;
  confidence?: number;
  /** Priceable candidates the median was chosen from. A pool of 1-2 means
   *  "mid-range" had nothing to choose from and the pick deserves a look. */
  poolSize?: number;
  pricePerUnit?: number;
  baseline: number | null;
  unit: string;
  status: ResolveStatus;
}

/**
 * Turn a SKU's shelf price into a price per the app's canonical unit.
 *
 * e.g. $4.79 for "16 oz" of a key whose baseline unit is `lb`
 *      -> 16 oz = 1 lb -> $4.79/lb
 *
 * Returns null when the size can't be landed in the baseline unit. That null is the
 * invariant that keeps rounding stable: getProfile() derives its sell unit from the
 * price entry and roundToPurchasable() branches on that unit's family, so publishing a
 * price in a different unit than the bundled row would silently change how quantities
 * are rounded. Rejecting is the only safe response.
 */
export function toPricePerBaselineUnit(
  shelfPrice: number,
  size: { qty: number; unit: string },
  baselineUnit: string,
  profile: ResolveProfile,
  convertMeasure: ConvertMeasure
): number | null {
  const qtyInBaseline = convertMeasure(size.qty, size.unit, baselineUnit, profile);
  if (qtyInBaseline === null || !Number.isFinite(qtyInBaseline) || qtyInBaseline <= 0) return null;
  return shelfPrice / qtyInBaseline;
}

export async function resolveIngredient(
  kroger: KrogerClient,
  input: ResolveInput,
  locationIds: string[],
  options: ResolveOptions
): Promise<Resolution> {
  const { convertMeasure, searchLimit = DEFAULT_SEARCH_LIMIT } = options;
  const profile: ResolveProfile = options.profile ?? {
    sellUnit: input.baselineUnit,
    packSize: 1,
  };

  const base: Resolution = {
    normalizedName: input.normalizedName,
    searchTerm: input.searchTerm,
    reviewed: input.reviewed,
    wasEnrolled: !input.krogerProductId,
    baseline: input.baselinePricePerUnit,
    unit: input.baselineUnit,
    status: 'unresolved',
  };

  const toBaseline = (shelfPrice: number, size: { qty: number; unit: string }) =>
    toPricePerBaselineUnit(shelfPrice, size, input.baselineUnit, profile, convertMeasure);

  // A reviewed mapping pins its SKU and is never re-searched, so review work is
  // permanent. Unreviewed rows re-search every run, which self-heals when a SKU
  // is discontinued.
  let productId = input.reviewed ? input.krogerProductId : null;
  let description: string | undefined;
  let confidence: number | undefined;
  let poolSize: number | undefined;
  let chosenAtPrimary: KrogerProduct | undefined;

  if (!productId) {
    const candidates = await kroger.searchProducts(input.searchTerm, locationIds[0], searchLimit);

    // Score every candidate first, so a pool that is entirely below the
    // confidence bar can be reported as low-confidence rather than no-candidate.
    const scored = candidates
      .map((product) => ({ product, score: scoreMatch(input.searchTerm, product.description) }))
      .filter((c) => c.score > 0);
    if (scored.length === 0) return { ...base, status: 'rejected:no-candidate' };

    const qualified = scored.filter((c) => input.reviewed || c.score >= MIN_CONFIDENCE);
    if (qualified.length === 0) {
      const bestScore = Math.max(...scored.map((c) => c.score));
      const best = scored.find((c) => c.score === bestScore)!;
      return {
        ...base,
        productId: best.product.productId,
        description: best.product.description,
        confidence: best.score,
        status: `rejected:low-confidence(${bestScore.toFixed(2)})`,
      };
    }

    // The search response already carries price and size per candidate at this
    // location, so ranking the pool by unit price costs no extra API calls.
    const priced = qualified.flatMap((c) => {
      const extracted = extractPrice(c.product);
      const size = extracted ? parseSize(extracted.size) : null;
      if (!extracted || !size) return [];
      const unitPrice = toBaseline(extracted.price, size);
      if (unitPrice === null) return [];
      return [{ ...c, unitPrice }];
    });
    if (priced.length === 0) return { ...base, status: 'rejected:no-priceable-candidate' };

    // Mid-priced candidate rather than cheapest: the store brand at the bottom
    // of the spread undershoots what a typical shopper actually buys.
    const chosen = pickMedianBy(
      priced,
      (c) => c.unitPrice,
      (c) => descriptionSpecificity(c.product.description)
    )!;

    productId = chosen.product.productId;
    description = chosen.product.description;
    confidence = chosen.score;
    poolSize = priced.length;
    chosenAtPrimary = chosen.product;
  }

  // Same SKU across every reference store; price varies, size does not.
  const prices: number[] = [];
  let size: string | undefined;

  // The search already returned this SKU priced at the primary store, so reuse
  // that rather than spending a second call re-fetching it.
  if (chosenAtPrimary) {
    const extracted = extractPrice(chosenAtPrimary);
    if (extracted) {
      prices.push(extracted.price);
      size = extracted.size;
    }
  }

  const remaining = chosenAtPrimary ? locationIds.slice(1) : locationIds;
  for (const locationId of remaining) {
    const product = await kroger.getProduct(productId, locationId);
    if (!product) continue;
    description = description ?? product.description;
    confidence = confidence ?? scoreMatch(input.searchTerm, product.description);
    const extracted = extractPrice(product);
    if (!extracted) continue;
    prices.push(extracted.price);
    size = size ?? extracted.size;
  }

  const shelfPrice = median(prices);
  if (shelfPrice === null || !size) {
    return { ...base, productId, description, confidence, status: 'rejected:no-price' };
  }

  const parsed = parseSize(size);
  if (!parsed) {
    return { ...base, productId, description, size, confidence, status: 'rejected:unparseable-size' };
  }

  const pricePerUnit = toBaseline(shelfPrice, parsed);
  if (pricePerUnit === null) {
    return { ...base, productId, description, size, confidence, status: 'rejected:unit-conflict' };
  }

  // With no baseline there is nothing meaningful to compare against, so the band is
  // skipped rather than faked. That is only reachable from the bootstrap path, whose
  // contract is that a human reviews the result before it becomes a price.
  if (
    input.baselinePricePerUnit !== null &&
    !sanityBand(pricePerUnit, input.baselinePricePerUnit, input.reviewed)
  ) {
    const ratio = (pricePerUnit / input.baselinePricePerUnit).toFixed(1);
    return {
      ...base,
      productId,
      description,
      size,
      confidence,
      pricePerUnit,
      status: `rejected:out-of-band(${ratio}x)`,
    };
  }

  return {
    ...base,
    productId,
    description,
    size,
    confidence,
    poolSize,
    pricePerUnit: round2(pricePerUnit),
    status: 'published',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
