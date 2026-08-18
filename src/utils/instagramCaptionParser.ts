import { Ingredient, NutritionPerServing } from '../types';
import { parseIngredient } from './ingredientParser';
import { ParsedRecipe, RecipeParseError } from './recipeUrlParser';

// Instagram captions are free-form prose, not structured data: a title line,
// emoji-decorated section headers, ad-hoc bullet styles, and trailing
// hashtag/CTA noise. This parser pulls a ParsedRecipe out of that text so the
// share-a-reel flow can reuse the same edit/save path as the URL importer.
// Pure + no I/O — fully testable without React Native.

// Broad-but-cheap emoji sweep: pictographs, dingbats, arrows, regional
// indicators, ZWJ + variation selectors + the keycap combiner. Deliberately
// does NOT touch U+00BC..U+00BE / U+2150.. so unicode fractions (½ ⅓ ¼) that
// parseIngredient relies on survive.
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

// Leading bullet/number markers. The numbered form REQUIRES trailing
// whitespace ("1. Season…") so a decimal quantity ("1.5 cups") is never
// mistaken for a list marker and truncated.
const BULLET_RE = /^\s*(?:[•\-*–—▪◦‣·]\s*|\d+[.)]\s+)/;

function stripBullet(s: string): string {
  return s.replace(BULLET_RE, '').trim();
}

// A non-bulleted line "looks like" an ingredient only when it leads with a
// quantity (digit or unicode fraction). Bulleted lines are trusted directly.
const STARTS_WITH_QTY = /^(?:\d|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/;

// Real ingredient lines are short; sentences in the method are long. This is
// the over-parse guard — a long line is never emitted as an ingredient.
const MAX_INGREDIENT_LEN = 80;

// A bulleted line with no leading quantity is the ambiguous case: it can be a
// bare ingredient ("• Butter", "• Shredded Lettuce") or a prose step
// ("• Marinate chicken for 30 mins or overnight…"). Word count separates them.
// The floor is set by real captions that write the quantity *last*
// ("• Chicken Stock Powder - 2 tsp" — 6 tokens), so this cannot go below 8.
const MAX_UNQUANTIFIED_WORDS = 9;

// First-token check for the same ambiguous case. Exact base-verb match only:
// "cooked"/"cooking" must NOT match "cook", or real ingredients get dropped.
// Deliberately excludes cream, pepper, butter, salt, chili, mix and top — all
// of them start real ingredient lines in captions we parse today.
const IMPERATIVE_VERBS = new Set([
  'add', 'air', 'assemble', 'bake', 'blend', 'boil', 'combine', 'cook', 'cut',
  'dip', 'drizzle', 'fold', 'fry', 'garnish', 'grill', 'heat', 'keep', 'let',
  'line', 'make', 'marinate', 'oven', 'place', 'pop', 'pour', 'preheat', 'put',
  'remove', 'repeat', 'roast', 'season', 'serve', 'slice', 'spread', 'sprinkle',
  'stir', 'store', 'toss', 'transfer', 'trim', 'use', 'whisk',
]);

type HeaderType = 'ingredients' | 'instructions' | null;

interface HeaderInfo {
  type: HeaderType;
  /** Text of a trailing parenthetical on the header line, e.g. "Makes 10 Tacos". */
  yieldHint: string | null;
}

// Whole-phrase header forms. Kept as exact matches because they are multi-word
// idioms with no single strong tail token.
const INGREDIENT_HEADER_EXACT =
  /^(?:ingredients?|what youll need|what you need|what you will need|you will need|youll need|you need|shopping list|grocery list)$/;
const INSTRUCTION_HEADER_EXACT =
  /^(?:instructions?|directions?|method|methods|steps?|preparation|prep|how to make(?: it| this)?|how to cook(?: it| this)?)$/;

// Strong tail tokens: a line ENDING in one of these is a header, but only when
// every word before it is a mere qualifier. Bare "ends with" is too loose —
// "swap any ingredients" and "ready in 5 steps" would both become headers, and
// the latter wins the findIndex over the real header further down.
const INGREDIENT_TAIL = new Set(['ingredient', 'ingredients']);
const INSTRUCTION_TAIL = new Set([
  'instruction', 'instructions', 'direction', 'directions',
  'method', 'methods', 'step', 'steps',
]);
const HEADER_QUALIFIERS = new Set([
  'all', 'base', 'complete', 'cooking', 'easy', 'full', 'important', 'main',
  'my', 'other', 'quick', 'recipe', 'remaining', 'simple', 'the', 'your',
]);

function normalizeForHeader(line: string): string {
  return stripEmoji(line)
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a trailing parenthetical off a line: "Ingredients (Makes 10 Tacos):" →
 * { head: "Ingredients", paren: "Makes 10 Tacos" }. Only fires when the line
 * *ends* with ")", so a mid-line note ("6 Tsp (30g) Olive Oil") is untouched.
 */
export function splitTrailingParenthetical(line: string): { head: string; paren: string | null } {
  let head = line.trim().replace(/[:.\s]+$/, '');
  let paren: string | null = null;

  // Loop so "Ingredients (v2) (Makes 6)" reduces fully; the last one wins.
  for (;;) {
    if (!head.endsWith(')')) break;
    let depth = 0;
    let open = -1;
    for (let i = head.length - 1; i >= 0; i--) {
      if (head[i] === ')') depth++;
      else if (head[i] === '(') {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    if (open < 0) break;
    if (paren === null) paren = head.slice(open + 1, -1).trim();
    head = head.slice(0, open).trim().replace(/[:.\s]+$/, '');
  }

  return { head, paren };
}

function matchesTail(words: string[], tails: Set<string>): boolean {
  if (words.length === 0) return false;
  if (!tails.has(words[words.length - 1])) return false;
  return words.slice(0, -1).every((w) => HEADER_QUALIFIERS.has(w));
}

function detectHeader(line: string): HeaderInfo {
  const { head, paren } = splitTrailingParenthetical(line);
  const norm = normalizeForHeader(head);
  const words = norm ? norm.split(' ') : [];

  // Emoji-only marker lines ("🛒", "👨‍🍳") carry the section intent alone. This
  // fires only when there is no text at all — a looser rule made "Enjoy👨‍🍳" an
  // instructions header, which truncated the method at the sign-off.
  if (words.length === 0) {
    if (/[\u{1F4DD}\u{1F6D2}]/u.test(line)) return { type: 'ingredients', yieldHint: paren };
    if (/\u{1F469}‍\u{1F373}|\u{1F468}‍\u{1F373}/u.test(line)) {
      return { type: 'instructions', yieldHint: paren };
    }
    return { type: null, yieldHint: null };
  }

  if (words.length <= 4) {
    if (INGREDIENT_HEADER_EXACT.test(norm) || matchesTail(words, INGREDIENT_TAIL)) {
      return { type: 'ingredients', yieldHint: paren };
    }
    if (INSTRUCTION_HEADER_EXACT.test(norm) || matchesTail(words, INSTRUCTION_TAIL)) {
      return { type: 'instructions', yieldHint: paren };
    }
  }
  return { type: null, yieldHint: null };
}

// Creators credit brands and other accounts inline: "300ml chicken stock- i used
// @knorruk". That tail is commentary, not part of the ingredient, and it breaks the
// price lookup's name match. Only an explicit attribution clause is stripped, so
// food-defining hyphens ("sun-dried tomatoes") are untouched.
const ATTRIBUTION_TAIL_RE =
  /\s*[-–—,]\s*(?:i\s+(?:used?|use|like|prefer|recommend)|or\s+use|used)\b.*$/i;

function stripAttribution(s: string): string {
  return s
    .replace(ATTRIBUTION_TAIL_RE, '')
    .replace(/\s*@[A-Za-z0-9._]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cut a trailing commentary sentence off an ingredient line: "1 Large Orange
 * Juiced + Orange Zest. I like to add bits of the pulp…" → "1 Large Orange
 * Juiced + Orange Zest".
 *
 * Deliberately narrow. The split point must be a period followed by whitespace
 * and a capital, the head must still be a plausible ingredient (>= 2 words) and
 * the tail a real sentence (>= 4 words). Anything looser eats "approx. 3 pieces"
 * and the 82-char guard line in the ingredient-block test.
 */
export function truncateCommentary(s: string): string {
  const idx = s.search(/\.\s+[A-Z]/);
  if (idx < 0) return s;
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx + 1).trim();
  if (head.split(/\s+/).length < 2) return s;
  if (tail.split(/\s+/).length < 4) return s;
  return head;
}

function isNoiseLine(line: string): boolean {
  const stripped = stripEmoji(line);
  if (!stripped) return true; // blank or emoji-only
  // Captions use punctuation-only lines as visual spacers ("." / "---" / "•••").
  // Left alone, each one becomes an instruction step.
  if (!/[a-z0-9]/i.test(stripped)) return true;
  const tokens = stripped.split(/\s+/);
  if (tokens.every((tok) => tok.startsWith('#'))) return true;
  // Sign-off line. Not worth a step of its own.
  if (/^enjoy[!.\s]*$/i.test(stripBullet(stripped))) return true;
  if (
    /\b(?:save (?:this|it|for)|follow(?: me| us| for| along)?|comment(?: below)?|link in bio|tag (?:a|your|someone)|double tap|share (?:this|with)|like and|hit the (?:like|follow))\b/i.test(
      stripped,
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeIngredient(line: string): boolean {
  const content = stripBullet(stripEmoji(line));
  if (!content) return false;

  const bulleted = BULLET_RE.test(stripEmoji(line));
  const quantified = STARTS_WITH_QTY.test(content);
  if (!bulleted && !quantified) return false;

  // Judge shape on the line minus its trailing commentary/parenthetical, so a
  // real ingredient carrying a long note is not rejected on length alone.
  const probe = splitTrailingParenthetical(truncateCommentary(content)).head;
  if (probe.length > MAX_INGREDIENT_LEN) return false;

  if (!quantified) {
    const words = probe.split(/\s+/).filter(Boolean);
    if (words.length > MAX_UNQUANTIFIED_WORDS) return false;
    if (IMPERATIVE_VERBS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) return false;
  }
  return true;
}

/** A short label line that introduces a sub-block ("Veggie Mix", "Spicy Garlic Sauce"). */
function isSubSectionTitle(line: string): boolean {
  const content = stripBullet(stripEmoji(line));
  if (!content) return false;
  if (/[.!?]$/.test(content)) return false;
  const words = content.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5;
}

function nextHeaderAfter(headers: HeaderInfo[], idx: number): number {
  for (let j = idx + 1; j < headers.length; j++) {
    if (headers[j].type !== null) return j;
  }
  return headers.length;
}

function findHeaderFrom(headers: HeaderInfo[], type: HeaderType, from: number): number {
  for (let j = Math.max(0, from); j < headers.length; j++) {
    if (headers[j].type === type) return j;
  }
  return -1;
}

interface Region {
  start: number;
  end: number; // exclusive
}

/**
 * Longest block of ingredient-looking lines, used when the caption has no
 * explicit "Ingredients" header.
 *
 * Tolerates short gaps so a run survives the sub-section titles and spacer
 * lines that split a real list into blocks. Still requires >= 2 ingredient
 * lines: a single quantity-led sentence ("2 INGREDIENTS FRESH PASTA") must not
 * be mistaken for a recipe, which is what routes prose captions to the paste
 * fallback.
 */
const MAX_RUN_GAP = 2;

function gapTolerantIngredientRun(
  lines: string[],
  headers: HeaderInfo[],
  isNoise: (i: number) => boolean,
): Region | null {
  const isIng = (i: number) =>
    headers[i].type === null && !isNoise(i) && looksLikeIngredient(lines[i]);
  const isGap = (i: number) =>
    headers[i].type === null && (isNoise(i) || isSubSectionTitle(lines[i]));

  let best: Region | null = null;
  let bestCount = 0;

  let start = -1;
  let lastIng = -1;
  let count = 0;
  let gap = 0;

  const close = () => {
    if (start !== -1 && count >= 2 && count > bestCount) {
      best = { start, end: lastIng + 1 };
      bestCount = count;
    }
    start = -1;
    lastIng = -1;
    count = 0;
    gap = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    if (isIng(i)) {
      if (start === -1) start = i;
      lastIng = i;
      count++;
      gap = 0;
    } else if (start !== -1 && isGap(i) && gap < MAX_RUN_GAP) {
      gap++;
    } else {
      close();
    }
  }
  close();
  return best;
}

// ---------------------------------------------------------------------------
// Creator-stated macros
// ---------------------------------------------------------------------------

const MACRO_LABELS: Array<[keyof NutritionPerServing, RegExp]> = [
  ['calories', /\b(?:calories|calorie|kcals?|cals?)\b/i],
  ['proteinG', /\bprotein\b/i],
  ['carbsG', /\b(?:carbs?|carbohydrates?)\b/i],
  ['fatG', /\bfat\b/i],
];

const NUMBER_RE = /\d+(?:\.\d+)?/;

export interface CaptionMacros {
  values: Partial<NutritionPerServing>;
  basis: 'per-serving' | 'total';
  /** Caption line indices consumed by the macro block. */
  lineIndices: number[];
  /** Trailing parenthetical of the "Macros Per X (…)" label line, if any. */
  yieldHint: string | null;
}

function readMacroKeys(line: string): Partial<NutritionPerServing> {
  const found: Partial<NutritionPerServing> = {};
  for (const segment of line.split(/[|•·,/]+/)) {
    for (const [key, re] of MACRO_LABELS) {
      if (found[key] !== undefined) continue;
      if (!re.test(segment)) continue;
      const num = segment.match(NUMBER_RE);
      if (!num) continue;
      found[key] = parseFloat(num[0]);
    }
  }
  return found;
}

const TOTAL_BASIS_RE =
  /^(?:total|whole|entire|full)\b[\s\S]*\bmacros?\b|\bmacros?\b[\s\S]*\bfor (?:the )?(?:whole|entire|full) recipe\b/i;

/**
 * Find the caption's macro block: "294 Calories | 28g Protein | 23g Carbs | 10g Fat",
 * or the two-line form "Calories- 539" / "Protein- 45.8g".
 *
 * Requires calories plus at least one other macro. Both halves matter: without
 * the >= 2 rule "30g whey protein" is a macro line, and without the calories
 * rule two adjacent ingredients ("300g Low Fat Yogurt", "30g Whey Protein")
 * combine into a phantom one and get eaten.
 */
export function scanCaptionMacros(rawLines: string[]): CaptionMacros | null {
  for (let i = 0; i < rawLines.length; i++) {
    const own = readMacroKeys(rawLines[i]);
    let values = own;
    const lineIndices = [i];

    if (Object.keys(own).length === 1 && i + 1 < rawLines.length) {
      const next = readMacroKeys(rawLines[i + 1]);
      const merged = { ...next, ...own };
      if (Object.keys(merged).length > Object.keys(own).length) {
        values = merged;
        lineIndices.push(i + 1);
      }
    }

    if (values.calories === undefined) continue;
    if (Object.keys(values).length < 2) continue;

    const label = lineIndices[0] > 0 ? rawLines[lineIndices[0] - 1] : '';
    const labelHead = splitTrailingParenthetical(label).head;
    return {
      values,
      basis: TOTAL_BASIS_RE.test(labelHead) ? 'total' : 'per-serving',
      lineIndices,
      yieldHint: /\bmacros?\b/i.test(label) ? splitTrailingParenthetical(label).paren : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Servings
// ---------------------------------------------------------------------------

/**
 * Yield stated inside a header's parenthetical: "(Makes 10 Tacos)" → 10,
 * "(5 Servings)" → 5, "(4 Servings Total)" → 4.
 *
 * A digit glued to a letter is a measurement, not a yield — "(30g portions)"
 * and "(9x13 pan)" must both come back null so the next tier gets a turn.
 */
export function yieldFromHint(hint: string | null): number | null {
  if (!hint) return null;
  for (const m of hint.matchAll(/\b(\d+)(?![a-z%x])/gi)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 50) return n;
  }
  return null;
}

function parseCaptionServings(caption: string): number {
  const labelFirst = caption.match(
    /\b(?:serves|serving for|makes|yields?)\s+(?:about\s+|approximately\s+|around\s+)?(\d+)/i,
  );
  if (labelFirst) return Math.max(1, parseInt(labelFirst[1], 10));
  const numberFirst = caption.match(/(\d+)\s+servings?\b/i);
  if (numberFirst) return Math.max(1, parseInt(numberFirst[1], 10));
  return 4;
}

const ALL_MACRO_KEYS: Array<keyof NutritionPerServing> = [
  'calories',
  'proteinG',
  'carbsG',
  'fatG',
];

export function parseRecipeFromCaption(caption: string, sourceUrl?: string): ParsedRecipe {
  const rawLines = caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length === 0) {
    throw new RecipeParseError('not-found', 'The caption was empty.');
  }

  const headers = rawLines.map(detectHeader);
  const macros = scanCaptionMacros(rawLines);
  const macroLines = new Set(macros?.lineIndices ?? []);
  const isNoise = (i: number) => isNoiseLine(rawLines[i]) || macroLines.has(i);
  const isIngredientLine = (i: number) =>
    headers[i].type === null && !isNoise(i) && looksLikeIngredient(rawLines[i]);

  const ingHeaderIdx = headers.findIndex((h) => h.type === 'ingredients');

  let region: Region;
  if (ingHeaderIdx >= 0) {
    region = { start: ingHeaderIdx + 1, end: nextHeaderAfter(headers, ingHeaderIdx) };
  } else {
    const run = gapTolerantIngredientRun(rawLines, headers, isNoise);
    if (!run) {
      throw new RecipeParseError('not-found', "Couldn't find an ingredients list in this caption.");
    }
    region = run;
  }

  // One pass over the region: ingredient lines are collected, sub-section
  // titles dropped (Ingredient has no group field), and anything else kept in
  // document order as instructions. That last part is what recovers captions
  // that interleave steps into the ingredient sections.
  const ingredientIdxs: number[] = [];
  const regionProse: number[] = [];
  for (let i = region.start; i < region.end; i++) {
    if (headers[i].type !== null || isNoise(i)) continue;
    if (isIngredientLine(i)) ingredientIdxs.push(i);
    else if (!isSubSectionTitle(rawLines[i])) regionProse.push(i);
  }

  const ingredients: Ingredient[] = ingredientIdxs
    .map((i) =>
      parseIngredient(truncateCommentary(stripAttribution(stripBullet(stripEmoji(rawLines[i]))))),
    )
    .filter((i) => i.name.trim().length > 0);

  if (ingredients.length === 0) {
    throw new RecipeParseError(
      'malformed',
      'Found an ingredients section but no ingredients could be read from it.',
    );
  }

  // Search for the method *after* the ingredients header, so an instruction-ish
  // line up in the blurb can't win the index.
  const instrHeaderIdx = findHeaderFrom(headers, 'instructions', Math.max(ingHeaderIdx, 0));
  const lastIngredient = ingredientIdxs[ingredientIdxs.length - 1];
  const [instrStart, instrEnd] =
    instrHeaderIdx >= 0
      ? [instrHeaderIdx + 1, nextHeaderAfter(headers, instrHeaderIdx)]
      : [lastIngredient + 1, nextHeaderAfter(headers, lastIngredient)];

  const instructionIdxs = [...regionProse];
  for (let i = Math.max(instrStart, region.end); i < instrEnd; i++) {
    if (headers[i].type === null && !isNoise(i)) instructionIdxs.push(i);
  }
  const instructions = instructionIdxs
    .map((i) => stripBullet(stripEmoji(rawLines[i])))
    .filter((s) => s.length > 0);

  const titleBoundary = ingHeaderIdx >= 0 ? ingHeaderIdx : region.start;
  let title = 'Untitled Recipe';
  for (let i = 0; i < titleBoundary; i++) {
    if (headers[i].type === null && !isNoise(i)) {
      const t = stripEmoji(rawLines[i]);
      if (t) {
        title = t;
        break;
      }
    }
  }

  const servings =
    yieldFromHint(ingHeaderIdx >= 0 ? headers[ingHeaderIdx].yieldHint : null) ??
    yieldFromHint(macros?.yieldHint ?? null) ??
    parseCaptionServings(caption);

  let nutritionPerServing: NutritionPerServing | undefined;
  let missingMacros: Array<keyof NutritionPerServing> = [...ALL_MACRO_KEYS];
  if (macros) {
    const divisor = macros.basis === 'total' ? Math.max(1, servings) : 1;
    const round = (n: number) => Math.round((n / divisor) * 10) / 10;
    nutritionPerServing = {
      calories: macros.values.calories !== undefined ? Math.round(macros.values.calories / divisor) : 0,
      proteinG: macros.values.proteinG !== undefined ? round(macros.values.proteinG) : 0,
      carbsG: macros.values.carbsG !== undefined ? round(macros.values.carbsG) : 0,
      fatG: macros.values.fatG !== undefined ? round(macros.values.fatG) : 0,
    };
    missingMacros = ALL_MACRO_KEYS.filter((k) => macros.values[k] === undefined);
  }

  return {
    title,
    sourceUrl,
    servings,
    ingredients,
    instructions: instructions.length > 0 ? instructions : undefined,
    imageUrl: undefined,
    nutritionPerServing,
    missingMacros,
  };
}
