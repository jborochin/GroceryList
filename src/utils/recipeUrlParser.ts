import { Ingredient, NutritionPerServing, Recipe } from '../types';
import { parseIngredient } from './ingredientParser';
import { computeMissingMacros } from './computeNutrition';

function isWebRuntime(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Mirror a real Chrome request — sites like allrecipes.com 403 anything that
// looks like a bare bot request. Kept in sync with supabase/functions/fetch-recipe.
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
};

const FETCH_TIMEOUT_MS = 15000;

export type RecipeParseErrorKind = 'network' | 'cors' | 'not-found' | 'malformed';

export class RecipeParseError extends Error {
  readonly kind: RecipeParseErrorKind;
  constructor(kind: RecipeParseErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type ParsedRecipe = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & {
  estimatedMacros?: Array<keyof NutritionPerServing>;
};

export interface JsonLdExtraction {
  blocks: unknown[];
  scriptsFound: number;
}

export async function parseRecipeFromUrl(url: string): Promise<ParsedRecipe> {
  const html = await fetchHtml(url);
  const { blocks, scriptsFound } = extractJsonLdBlocks(html);
  const recipeNode = findRecipeNode(blocks);
  if (!recipeNode) {
    if (scriptsFound > 0 && blocks.length < scriptsFound) {
      throw new RecipeParseError('malformed', 'JSON-LD scripts present but unparseable.');
    }
    throw new RecipeParseError('not-found', 'No recipe schema found on this page.');
  }
  const { parsed, ingredientStrings, missing } = mapRecipeNode(recipeNode, url);
  if (missing.length === 0) return parsed;

  // Tier 2: HTML scrape — authoritative since values come from the source page.
  const scraped = scrapeNutritionFromHtml(html);
  let mergedParsed: ParsedRecipe = parsed;
  const filled: Array<keyof NutritionPerServing> = [];
  for (const key of missing) {
    if (typeof scraped[key] === 'number') filled.push(key);
  }
  if (filled.length > 0) {
    const base: NutritionPerServing = parsed.nutritionPerServing ?? {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    };
    const merged: NutritionPerServing = { ...base };
    for (const key of filled) merged[key] = scraped[key]!;
    mergedParsed = { ...parsed, nutritionPerServing: merged };
  }
  const stillMissing = missing.filter((k) => !filled.includes(k));
  if (stillMissing.length === 0 || ingredientStrings.length === 0) return mergedParsed;

  // Tier 3: CalorieNinjas — estimated values, flagged for the badge.
  const computed = await computeMissingMacros(ingredientStrings, mergedParsed.servings, stillMissing);
  if (!computed) return mergedParsed;
  const finalBase: NutritionPerServing = mergedParsed.nutritionPerServing ?? {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  };
  return {
    ...mergedParsed,
    nutritionPerServing: { ...finalBase, ...computed },
    estimatedMacros: Object.keys(computed) as Array<keyof NutritionPerServing>,
  };
}

async function fetchHtml(url: string): Promise<string> {
  if (isWebRuntime()) {
    return fetchHtmlViaProxy(url);
  }
  return fetchHtmlDirect(url);
}

interface ProxyResponse {
  ok: boolean;
  html?: string;
  kind?: string;
  message?: string;
  status?: number;
}

async function fetchHtmlViaProxy(url: string): Promise<string> {
  // Lazy import: supabase pulls in native-only polyfills, so importing it at
  // module top would break Jest (which never hits this code path because
  // isWebRuntime() is false under jsdom-free node).
  const { getSupabase, supabaseConfigured } = await import('../lib/supabase');
  if (!supabaseConfigured) {
    return fetchHtmlDirect(url);
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke<ProxyResponse>('fetch-recipe', {
    body: { url },
  });
  if (error || !data) {
    throw new RecipeParseError('network', error?.message || 'Proxy request failed');
  }
  if (!data.ok) {
    const message = data.message || `Proxy error: ${data.kind ?? 'unknown'}`;
    throw new RecipeParseError('network', message);
  }
  if (typeof data.html !== 'string') {
    throw new RecipeParseError('network', 'Proxy returned no html');
  }
  return data.html;
}

async function fetchHtmlDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (res.ok) {
      return await res.text();
    }
    // Bot-protected sites (Cloudflare/Akamai) typically return 403/429/503 even
    // with a real-browser header set. Wayback Machine usually has a recent
    // snapshot with the original JSON-LD intact.
    if (isBlockedStatus(res.status)) {
      const archived = await fetchHtmlFromWayback(url, controller.signal);
      if (archived) return archived;
    }
    throw new RecipeParseError('network', `HTTP ${res.status}`);
  } catch (err: unknown) {
    if (err instanceof RecipeParseError) throw err;
    const message = err instanceof Error ? err.message : 'Fetch failed';
    if (isWebRuntime() && err instanceof TypeError) {
      throw new RecipeParseError(
        'cors',
        'Browser blocked the request (likely CORS). The site does not allow cross-origin reads.',
      );
    }
    throw new RecipeParseError('network', message);
  } finally {
    clearTimeout(timer);
  }
}

function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 503;
}

async function fetchHtmlFromWayback(originalUrl: string, signal: AbortSignal): Promise<string | null> {
  const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
  let availRes: Response;
  try {
    availRes = await fetch(availUrl, { signal });
  } catch {
    return null;
  }
  if (!availRes.ok) return null;
  let avail: { archived_snapshots?: { closest?: { available?: boolean; timestamp?: string } } };
  try {
    avail = await availRes.json();
  } catch {
    return null;
  }
  const closest = avail.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) return null;
  // The `id_` modifier returns the raw archived HTML without the Wayback toolbar
  // wrapper, keeping JSON-LD blocks byte-identical to the original page.
  const rawUrl = `https://web.archive.org/web/${closest.timestamp}id_/${originalUrl}`;
  let rawRes: Response;
  try {
    rawRes = await fetch(rawUrl, { signal });
  } catch {
    return null;
  }
  if (!rawRes.ok) return null;
  return await rawRes.text();
}

export function extractJsonLdBlocks(html: string): JsonLdExtraction {
  const blocks: unknown[] = [];
  let scriptsFound = 0;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    scriptsFound += 1;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // block counted in scriptsFound but not pushed — caller can detect malformed
    }
  }
  return { blocks, scriptsFound };
}

export function findRecipeNode(blocks: unknown[]): Record<string, unknown> | null {
  const visit = (node: unknown): Record<string, unknown> | null => {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const found = visit(n);
        if (found) return found;
      }
      return null;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const t = obj['@type'];
      if (isRecipeType(t)) return obj;
      if (obj['@graph']) {
        const found = visit(obj['@graph']);
        if (found) return found;
      }
      // Many sites nest Recipe under an array of mainEntity / itemListElement
      for (const key of Object.keys(obj)) {
        if (key === '@type') continue;
        const v = obj[key];
        if (v && (Array.isArray(v) || typeof v === 'object')) {
          const found = visit(v);
          if (found) return found;
        }
      }
    }
    return null;
  };
  for (const block of blocks) {
    const found = visit(block);
    if (found) return found;
  }
  return null;
}

function isRecipeType(t: unknown): boolean {
  if (!t) return false;
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.includes('Recipe'));
  return typeof t === 'string' && t.includes('Recipe');
}

const ALL_MACRO_KEYS: Array<keyof NutritionPerServing> = ['calories', 'proteinG', 'carbsG', 'fatG'];

interface MappedRecipe {
  parsed: ParsedRecipe;
  ingredientStrings: string[];
  missing: Array<keyof NutritionPerServing>;
}

function mapRecipeNode(node: Record<string, unknown>, sourceUrl: string): MappedRecipe {
  const title = stringOrEmpty(node.name) || 'Untitled Recipe';
  const servings = parseServings(node.recipeYield);
  const ingredientStrings = coerceStringArray(node.recipeIngredient ?? node.ingredients);
  const ingredients: Ingredient[] = ingredientStrings.map(parseIngredient);
  const instructions = parseInstructions(node.recipeInstructions);

  const nutritionNode = node.nutrition;
  let nutritionPerServing: NutritionPerServing | undefined;
  let missing: Array<keyof NutritionPerServing>;
  if (isRecord(nutritionNode)) {
    const parsedN = parseNutrition(nutritionNode);
    nutritionPerServing = parsedN.values;
    missing = parsedN.missing;
  } else {
    nutritionPerServing = undefined;
    missing = [...ALL_MACRO_KEYS];
  }

  const parsed: ParsedRecipe = {
    title,
    sourceUrl,
    servings,
    ingredients,
    instructions: instructions.length > 0 ? instructions : undefined,
    nutritionPerServing,
  };

  return { parsed, ingredientStrings, missing };
}

export function parseInstructions(raw: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      // A single string may contain the entire method. Split on line breaks so
      // each paragraph becomes a step; most sites use <br> / newlines between steps.
      for (const part of node.split(/\r?\n+/)) {
        const cleaned = stripHtml(part).trim();
        if (cleaned) out.push(cleaned);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const t = obj['@type'];
      const isSection = typeof t === 'string' && t === 'HowToSection';
      if (isSection) {
        visit(obj.itemListElement);
        return;
      }
      if (typeof obj.text === 'string') {
        const cleaned = stripHtml(obj.text).trim();
        if (cleaned) out.push(cleaned);
        return;
      }
      if (typeof obj.name === 'string') {
        const cleaned = stripHtml(obj.name).trim();
        if (cleaned) out.push(cleaned);
      }
    }
  };
  visit(raw);
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function parseServings(raw: unknown): number {
  if (typeof raw === 'number') return Math.max(1, Math.round(raw));
  if (typeof raw === 'string') {
    const m = raw.match(/\d+/);
    if (m) return Math.max(1, parseInt(m[0], 10));
  }
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const parsed = parseServings(v);
      if (parsed) return parsed;
    }
  }
  return 4;
}

export interface ParsedNutrition {
  values: NutritionPerServing | undefined;
  missing: Array<keyof NutritionPerServing>;
}

export function parseNutrition(n: Record<string, unknown>): ParsedNutrition {
  const calories = parseNumberWithUnit(n.calories);
  const proteinG = parseNumberWithUnit(n.proteinContent);
  const carbsG = parseNumberWithUnit(n.carbohydrateContent);
  const fatG = parseNumberWithUnit(n.fatContent);
  const missing: Array<keyof NutritionPerServing> = [];
  if (calories === undefined) missing.push('calories');
  if (proteinG === undefined) missing.push('proteinG');
  if (carbsG === undefined) missing.push('carbsG');
  if (fatG === undefined) missing.push('fatG');
  if (missing.length === 4) {
    return { values: undefined, missing };
  }
  return {
    values: {
      calories: calories ?? 0,
      proteinG: proteinG ?? 0,
      carbsG: carbsG ?? 0,
      fatG: fatG ?? 0,
    },
    missing,
  };
}

function parseNumberWithUnit(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/[\d.]+/);
    if (m) return parseFloat(m[0]);
  }
  return undefined;
}

// Maps each NutritionPerServing key to the schema.org itemprop / JSON-LD property name.
const MICRODATA_PROPS: Array<[keyof NutritionPerServing, string]> = [
  ['calories', 'calories'],
  ['proteinG', 'proteinContent'],
  ['carbsG', 'carbohydrateContent'],
  ['fatG', 'fatContent'],
];

function findMicrodataValue(html: string, prop: string): number | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // <meta itemprop="X" content="Y"> in either attribute order.
  const metaA = new RegExp(`<meta\\b[^>]*itemprop=["']${escaped}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i');
  const metaB = new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']+)["'][^>]*itemprop=["']${escaped}["']`, 'i');
  // <span itemprop="X">Y</span> — any non-meta tag, take inner text up to next '<'.
  const inner = new RegExp(`<(?!meta\\b)[a-z][a-z0-9]*\\b[^>]*itemprop=["']${escaped}["'][^>]*>([^<]+)`, 'i');
  for (const re of [metaA, metaB, inner]) {
    const m = html.match(re);
    if (m) {
      const num = parseNumberWithUnit(m[1].trim());
      if (typeof num === 'number' && Number.isFinite(num)) return num;
    }
  }
  return undefined;
}

// Text-pattern regexes per macro. Each macro has a "number-then-label" form (e.g. "38 g pro")
// and a "label-then-number" form (e.g. "Protein: 38g") since recipe sites differ.
interface TextPattern {
  numberFirst: RegExp;
  labelFirst: RegExp;
}

const TEXT_PATTERNS: Record<keyof NutritionPerServing, TextPattern> = {
  calories: {
    numberFirst: /(\d+(?:\.\d+)?)\s*(?:kcal\b|cal\b|calories\b)/i,
    labelFirst: /(?:kcal\b|calories\b|\bcal\b)[:\s]+(\d+(?:\.\d+)?)/i,
  },
  proteinG: {
    numberFirst: /(\d+(?:\.\d+)?)\s*g\s+(?:pro\b|protein\b|proteins\b)/i,
    labelFirst: /(?:^|[^a-z])(?:protein|proteins)\b[:\s]+(\d+(?:\.\d+)?)\s*g\b/i,
  },
  carbsG: {
    numberFirst: /(\d+(?:\.\d+)?)\s*g\s+(?:carb\b|carbs\b|carbohydrates?\b)/i,
    labelFirst: /(?:^|[^a-z])(?:carb|carbs|carbohydrates?)\b[:\s]+(\d+(?:\.\d+)?)\s*g\b/i,
  },
  fatG: {
    numberFirst: /(\d+(?:\.\d+)?)\s*g\s+(?:total\s+)?fat\b/i,
    labelFirst: /(?:^|[^a-z])(?:total\s+)?fat\b[:\s]+(\d+(?:\.\d+)?)\s*g\b/i,
  },
};

const ANCHOR_RE = /nutrition|per serving/gi;
const WINDOW_SIZE = 600;
const MAX_ANCHORS = 40;

function extractMacrosFromWindow(text: string): Partial<NutritionPerServing> {
  // Mask "sat fat" / "saturated fat" first so the total-fat regex doesn't latch onto it.
  const masked = text.replace(/\d+(?:\.\d+)?\s*g\s+sat(?:urated)?\s+fat/gi, '');
  const found: Partial<NutritionPerServing> = {};
  for (const key of ALL_MACRO_KEYS) {
    const pattern = TEXT_PATTERNS[key];
    const m = masked.match(pattern.numberFirst) ?? masked.match(pattern.labelFirst);
    if (m) {
      const num = parseFloat(m[1]);
      if (Number.isFinite(num)) found[key] = num;
    }
  }
  return found;
}

export function scrapeNutritionFromHtml(html: string): Partial<NutritionPerServing> {
  const out: Partial<NutritionPerServing> = {};

  // Tier 2a: schema.org microdata (most structured signal short of JSON-LD).
  for (const [key, prop] of MICRODATA_PROPS) {
    const v = findMicrodataValue(html, prop);
    if (typeof v === 'number') out[key] = v;
  }
  if (ALL_MACRO_KEYS.every((k) => typeof out[k] === 'number')) return out;

  // Tier 2b: text-pattern scrape in a localized window. We can't trust the FIRST
  // occurrence of "nutrition" — on real pages it's usually the URL ("/food-nutrition/")
  // or a nav link. Strip script/style blocks (JSON-LD lives in <script>) and then
  // scan every candidate anchor, picking the first window that actually yields macros.
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = ANCHOR_RE.exec(stripped)) !== null && seen < MAX_ANCHORS) {
    seen += 1;
    const text = stripHtml(stripped.slice(match.index, match.index + WINDOW_SIZE));
    const found = extractMacrosFromWindow(text);
    if (Object.keys(found).length === 0) continue;
    for (const key of ALL_MACRO_KEYS) {
      if (typeof out[key] === 'number') continue;
      if (typeof found[key] === 'number') out[key] = found[key];
    }
    break;
  }

  return out;
}

function stringOrEmpty(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
}

function coerceStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return [v];
  return [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
