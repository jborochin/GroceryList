import { Ingredient, NutritionPerServing, Recipe } from '../types';
import { parseIngredient } from './ingredientParser';

function isWebRuntime(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15000;

export type RecipeParseErrorKind = 'network' | 'cors' | 'not-found' | 'malformed';

export class RecipeParseError extends Error {
  readonly kind: RecipeParseErrorKind;
  constructor(kind: RecipeParseErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type ParsedRecipe = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>;

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
  return mapRecipeNode(recipeNode, url);
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
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new RecipeParseError('network', `HTTP ${res.status}`);
    }
    return await res.text();
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

function mapRecipeNode(node: Record<string, unknown>, sourceUrl: string): ParsedRecipe {
  const title = stringOrEmpty(node.name) || 'Untitled Recipe';
  const servings = parseServings(node.recipeYield);
  const ingredientStrings = coerceStringArray(node.recipeIngredient ?? node.ingredients);
  const ingredients: Ingredient[] = ingredientStrings.map(parseIngredient);
  const instructions = parseInstructions(node.recipeInstructions);

  const nutritionNode = node.nutrition;
  const nutritionPerServing = isRecord(nutritionNode) ? parseNutrition(nutritionNode) : undefined;

  return {
    title,
    sourceUrl,
    servings,
    ingredients,
    instructions: instructions.length > 0 ? instructions : undefined,
    nutritionPerServing,
  };
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

function parseNutrition(n: Record<string, unknown>): NutritionPerServing | undefined {
  const calories = parseNumberWithUnit(n.calories);
  const proteinG = parseNumberWithUnit(n.proteinContent);
  const carbsG = parseNumberWithUnit(n.carbohydrateContent);
  const fatG = parseNumberWithUnit(n.fatContent);
  if (calories === undefined && proteinG === undefined && carbsG === undefined && fatG === undefined) {
    return undefined;
  }
  return {
    calories: calories ?? 0,
    proteinG: proteinG ?? 0,
    carbsG: carbsG ?? 0,
    fatG: fatG ?? 0,
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
