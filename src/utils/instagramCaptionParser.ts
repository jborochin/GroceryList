import { Ingredient } from '../types';
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

type HeaderType = 'ingredients' | 'instructions' | null;

// Header phrases, matched against a letters-only, lowercased, apostrophe-
// stripped copy of the line ("What you'll need" -> "what youll need").
const INGREDIENT_HEADER =
  /^(?:ingredients?|what youll need|what you need|what you will need|you will need|youll need|you need|shopping list|grocery list)$/;
const INSTRUCTION_HEADER =
  /^(?:instructions?|directions?|method|methods|steps?|preparation|prep|how to make(?: it| this)?|how to cook(?: it| this)?)$/;

function normalizeForHeader(line: string): string {
  return stripEmoji(line)
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectHeaderType(line: string): HeaderType {
  const norm = normalizeForHeader(line);
  const wordCount = norm ? norm.split(' ').length : 0;
  if (norm && wordCount <= 4) {
    if (INGREDIENT_HEADER.test(norm)) return 'ingredients';
    if (INSTRUCTION_HEADER.test(norm)) return 'instructions';
  }
  // Emoji-led headers: "📝 Ingredients" already caught above, but bare
  // "🛒" / "👩‍🍳" markers carry the section intent on their own.
  if (/[\u{1F4DD}\u{1F6D2}]/u.test(line) && wordCount <= 3) return 'ingredients';
  if (/\u{1F469}‍\u{1F373}|\u{1F468}‍\u{1F373}/u.test(line) && wordCount <= 3) {
    return 'instructions';
  }
  return null;
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

function isNoiseLine(line: string): boolean {
  const stripped = stripEmoji(line);
  if (!stripped) return true; // blank or emoji-only
  // Captions use punctuation-only lines as visual spacers ("." / "---" / "•••").
  // Left alone, each one becomes an instruction step.
  if (!/[a-z0-9]/i.test(stripped)) return true;
  const tokens = stripped.split(/\s+/);
  if (tokens.every((tok) => tok.startsWith('#'))) return true;
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
  if (content.length > MAX_INGREDIENT_LEN) return false;
  if (BULLET_RE.test(stripEmoji(line))) return true;
  return STARTS_WITH_QTY.test(content);
}

function nextHeaderAfter(headerTypes: HeaderType[], idx: number): number {
  for (let j = idx + 1; j < headerTypes.length; j++) {
    if (headerTypes[j] !== null) return j;
  }
  return headerTypes.length;
}

interface Run {
  start: number;
  end: number; // exclusive
}

// Longest contiguous block of ingredient-looking, non-noise lines. Used when
// the caption has no explicit "Ingredients" header. Requires >= 2 lines so a
// stray quantity sentence isn't mistaken for the whole list.
function longestIngredientRun(lines: string[], headerTypes: HeaderType[]): Run | null {
  let best: Run | null = null;
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const ok =
      i < lines.length &&
      headerTypes[i] === null &&
      !isNoiseLine(lines[i]) &&
      looksLikeIngredient(lines[i]);
    if (ok) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      const len = i - start;
      if (len >= 2 && (!best || len > best.end - best.start)) best = { start, end: i };
      start = -1;
    }
  }
  return best;
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

export function parseRecipeFromCaption(caption: string, sourceUrl?: string): ParsedRecipe {
  const rawLines = caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length === 0) {
    throw new RecipeParseError('not-found', 'The caption was empty.');
  }

  const headerTypes = rawLines.map(detectHeaderType);
  const ingHeaderIdx = headerTypes.findIndex((h) => h === 'ingredients');
  const instrHeaderIdx = headerTypes.findIndex((h) => h === 'instructions');

  let ingredientLines: string[];
  let instructionLines: string[];
  let titleBoundary: number;

  if (ingHeaderIdx >= 0) {
    ingredientLines = rawLines.slice(ingHeaderIdx + 1, nextHeaderAfter(headerTypes, ingHeaderIdx));
    instructionLines =
      instrHeaderIdx >= 0
        ? rawLines.slice(instrHeaderIdx + 1, nextHeaderAfter(headerTypes, instrHeaderIdx))
        : [];
    titleBoundary = ingHeaderIdx;
  } else {
    const run = longestIngredientRun(rawLines, headerTypes);
    if (!run) {
      throw new RecipeParseError(
        'not-found',
        "Couldn't find an ingredients list in this caption.",
      );
    }
    ingredientLines = rawLines.slice(run.start, run.end);
    instructionLines = rawLines.slice(run.end);
    titleBoundary = run.start;
  }

  const ingredients: Ingredient[] = ingredientLines
    .filter((l) => !isNoiseLine(l) && looksLikeIngredient(l))
    .map((l) => parseIngredient(stripAttribution(stripBullet(stripEmoji(l)))))
    .filter((i) => i.name.trim().length > 0);

  if (ingredients.length === 0) {
    throw new RecipeParseError(
      'malformed',
      'Found an ingredients section but no ingredients could be read from it.',
    );
  }

  const instructions = instructionLines
    .filter((l) => !isNoiseLine(l))
    .map((l) => stripBullet(stripEmoji(l)))
    .filter((s) => s.length > 0);

  let title = 'Untitled Recipe';
  for (let i = 0; i < titleBoundary; i++) {
    if (headerTypes[i] === null && !isNoiseLine(rawLines[i])) {
      const t = stripEmoji(rawLines[i]);
      if (t) {
        title = t;
        break;
      }
    }
  }

  return {
    title,
    sourceUrl,
    servings: parseCaptionServings(caption),
    ingredients,
    instructions: instructions.length > 0 ? instructions : undefined,
    imageUrl: undefined,
  };
}
