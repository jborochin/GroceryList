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
// The explicit singletons at the end are pictographs stranded outside the block
// ranges: ‼ ⁉ ™ ℹ 〰 〽 ㊗ ㊙. U+203C in particular opens captions ("SAVE THIS ‼️")
// and, left behind, becomes the first character of the recipe's title.
// Deliberately does NOT sweep the rest of U+2000–U+206F: the ellipsis (U+2026)
// and en/em dashes live there and are load-bearing for title and header parsing.
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{203C}\u{2049}\u{2122}\u{2139}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;

// Keycap emoji — "1️⃣" is a digit plus U+FE0F plus the U+20E3 combiner. Creators
// number their steps with these, and the whole grapheme has to go together: the
// general sweep below strips the combiner and leaves a bare ASCII digit behind,
// which BULLET_RE won't take (it requires a "." or ")") so the number survives
// into the step text and the UI numbers it a second time. Worse, the leftover
// digit reads as a quantity, so "2️⃣ In a bowl…" parses as 2 of something.
//
// Keyed on U+20E3 being present, so it can never touch a real quantity: "1.5
// cups" has no combiner.
const KEYCAP_RE = /[0-9#*]️?⃣/gu;

function stripEmoji(s: string): string {
  return s.replace(KEYCAP_RE, '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
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
  if (CALL_TO_ACTION_RE.test(stripped)) return true;
  return false;
}

// Engagement bait. Named because the title search needs it too: creators open
// with "SAVE THIS ‼️ High Protein Street Corn Chicken Bowl", where the CTA and
// the dish name share a line and discarding the line loses the title.
const CALL_TO_ACTION_RE =
  /\b(?:save (?:this|it|for)|follow(?: me| us| for| along)?|comment(?: below)?|link in bio|tag (?:a|your|someone)|double tap|share (?:this|with)|like and|hit the (?:like|follow))\b/gi;

function stripCallToAction(s: string): string {
  return s.replace(CALL_TO_ACTION_RE, ' ').replace(/\s+/g, ' ').trim();
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
  // Trailing punctuation is stripped BEFORE counting, because creators leave a
  // space in front of the colon ("For the creamy Alfredo sauce :") and the
  // orphaned ":" counted as a sixth word, pushing a real heading over the cap.
  const head = content.replace(/[:\-–—\s]+$/, '');
  const words = head.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5;
}

/**
 * An ingredient that carries neither a bullet nor a leading quantity — "Salt to
 * taste", "Vanilla bean or vanilla bean paste".
 *
 * In isolation this is the same shape as a sub-recipe title, which is why it
 * used to be silently dropped (and, once sections were introduced, promoted to a
 * heading that swallowed the rest of the list). Context is what separates them:
 * a heading opens a block after a blank line, while this sits mid-run. The
 * caller supplies that; this only judges the shape.
 *
 * The terminal-punctuation guard is what keeps prose out — "Let this marinate
 * overnight if possible, way more flavor!" is nine words and mid-run, and its
 * exclamation mark is the only thing that reliably disqualifies it.
 */
function looksLikeRunIngredient(line: string): boolean {
  const content = stripBullet(stripEmoji(line));
  if (!content) return false;
  if (/[.!?:]$/.test(content)) return false;
  const probe = splitTrailingParenthetical(truncateCommentary(content)).head;
  if (probe.length > MAX_INGREDIENT_LEN) return false;
  const words = probe.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_UNQUANTIFIED_WORDS) return false;
  return !IMPERATIVE_VERBS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''));
}

/**
 * The same line as a usable label: "🥗 Veggie Mix:" → "Veggie Mix".
 *
 * Gated by isSubSectionTitle rather than replacing it — gapTolerantIngredientRun
 * relies on that predicate's looseness to bridge sub-blocks, so tightening it
 * would change which region is found. Whether a title is loose enough to be
 * junk is settled later, by requiring an ingredient to follow it.
 *
 * A BULLETED line is never a title. Creators bullet their ingredients and leave
 * the sub-recipe heading bare, in every caption in the corpus. Without this,
 * a short bulleted step whose verb keeps it out of the ingredient list
 * ("• Assemble now") becomes a section and captures everything under it.
 */
export function subSectionLabel(line: string): string | null {
  if (BULLET_RE.test(stripEmoji(line))) return null;
  if (!isSubSectionTitle(line)) return null;
  const label = stripEmoji(line).replace(/[:\-–—\s]+$/, '').trim();
  if (!label) return null;
  // "RECIPE" over the whole list names nothing — it is a header detectHeader
  // deliberately won't claim (see the note on the tail tokens: "recipe" there
  // would make "Viral chicken broth pasta // recipe" a header instead of a
  // title). Rejecting it here keeps it from becoming a meaningless section.
  return GENERIC_LABELS.has(label.toLowerCase()) ? null : label;
}

const GENERIC_LABELS = new Set([
  'recipe', 'recipes', 'the recipe', 'full recipe', 'ingredients', 'ingredient',
  'instructions', 'directions', 'method', 'steps', 'notes',
]);

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
// Title
// ---------------------------------------------------------------------------

// A title is a dish name — a noun phrase. Creators routinely open with a
// marketing sentence instead ("If you need an easy dinner recipe using a pound
// of ground beef, this Sloppy Joe Potato Skillet won't disappoint!"), and taking
// the first line verbatim saves the recipe under that whole sentence.
//
// Everything below is shape-based and deliberately conservative: a line that
// already reads as a dish name is returned untouched, and a blurb that none of
// the rules can reduce is left alone rather than guessed at.
const MAX_TITLE_WORDS = 10;

/**
 * Sentence punctuation followed by a space. A dish name has none; a trailing "!"
 * is fine. The colon is included because a headline of the form "X: Y" is nearly
 * always "Category: Dish" — "Masters Game Food Dish: Cheesy Buffalo Chicken
 * Stuffed Garlic Bread" — so the half after it is the one worth keeping.
 */
const TITLE_MID_SENTENCE = /[.!?,;:]\s/;

/** Openers that are never part of the dish name. */
const TITLE_LEAD_IN =
  /^(?:save (?:this|it)|here'?s|this is|these are|these|this|if you|when you|i (?:made|make|love)|my|our|the recipes?|new recipe)\b[\s,:—–-]*/i;

/** A copula or relative clause — "…Tenders Are Insanely Good", "…Skillet won't disappoint". */
const TITLE_VERB_TAIL = /\s+(?:is|are|was|were|will|won[’']?t|wont|never|always|that|which)\s+.*$/i;

/**
 * "Cheesy Buffalo Chicken Stuffed Garlic Bread Recipe" → drop the trailing
 * label, along with any separator holding it on ("Viral chicken broth pasta //
 * recipe"), so the strip doesn't leave a dangling "//".
 */
const TITLE_TRAILING_RECIPE = /[\s,:—–|/-]*\b(?:recipe|recipes)\b[\s.:!]*$/i;

function looksLikeCleanTitle(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 3) return false;
  // Must open like a name. This is what stops the reductions from returning a
  // tidy-looking fragment of a sentence: "I have made this every single week…"
  // yields "every single week for the last two months", which passes every other
  // check here. Costs nothing when a creator writes an all-lowercase title —
  // no candidate qualifies, so the caller falls back to the line unmodified.
  if (!/^[A-Z0-9]/.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > MAX_TITLE_WORDS) return false;
  if (TITLE_MID_SENTENCE.test(trimmed)) return false;
  if (TITLE_VERB_TAIL.test(trimmed)) return false;
  // "Recipe ⬇️" is a pointer at the recipe, not its name — the dish is on the
  // next line. Same stoplist the section labels use.
  if (GENERIC_LABELS.has(trimmed.toLowerCase())) return false;
  return !TITLE_LEAD_IN.test(trimmed);
}

/**
 * Reduce one caption line to the dish name inside it, or return it unchanged.
 *
 * Builds candidate reductions and returns the first that reads as a dish name,
 * so a line that is already clean short-circuits immediately and never runs the
 * aggressive rules. If nothing qualifies the original comes back — a wrong guess
 * is worse than a long title, and the caller can try the next line.
 */
export function cleanTitleLine(raw: string): string {
  const base = splitTrailingParenthetical(stripEmoji(raw))
    .head.replace(/[\s.!?:,;—–-]+$/, '')
    .trim();
  if (!base) return '';

  const candidates: string[] = [];
  const push = (s: string) => {
    const t = s
      .replace(TITLE_TRAILING_RECIPE, '')
      .replace(/^[\s,:—–-]+|[\s,.:!?;—–-]+$/g, '')
      .trim();
    if (t) candidates.push(t);
  };
  push(base);

  // "Masters Game Food Dish: Cheesy Buffalo Chicken Stuffed Garlic Bread",
  // "The recipes every home cook should know. Ep 20: Korean Popcorn Chicken".
  const colon = base.lastIndexOf(':');
  if (colon >= 0) push(base.slice(colon + 1));

  // "Cinnamon rolls… made in 20 minutes, and every bite…" → the first clause.
  const clause = base
    .split(/[.!?…]+/)
    .map((s) => s.trim())
    .find((s) => s.split(/\s+/).length >= 2);
  if (clause) push(clause);

  for (const source of [clause ?? base, base]) {
    let s = source.replace(TITLE_LEAD_IN, '');
    push(s);
    // "…of ground beef, this Sloppy Joe Potato Skillet won't disappoint".
    const demonstrative = s.match(/\b(?:this|these)\s+(.+)$/i);
    if (demonstrative) {
      s = demonstrative[1];
      push(s);
    }
    push(s.replace(TITLE_VERB_TAIL, ''));
    // "Honey Butter Chicken Alfredo Pasta My Best Meal Prep Recipes Of 2025".
    const possessive = s.split(/\s+(?:My|Our)\s+/);
    if (possessive.length > 1) push(possessive[0]);
  }

  return candidates.find(looksLikeCleanTitle) ?? base;
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

// Abbreviated macro notation: "31g P | 43g C | 5g F". Without these the segment
// matches no label, the two-line merge finds nothing, and the whole line falls
// through to become an ingredient row reading "31 g p | 43 g c | 5 g f".
//
// Deliberately anchored to the WHOLE segment — a number, an optional "g", and a
// lone letter, nothing else. A bare `\bp\b` would match half the caption, and
// loosening these to allow trailing words would make "2 c flour" a carb count.
const ABBREVIATED_MACRO_LABELS: Array<[keyof NutritionPerServing, RegExp]> = [
  ['proteinG', /^\s*\d+(?:\.\d+)?\s*g?\s*p\s*$/i],
  ['carbsG', /^\s*\d+(?:\.\d+)?\s*g?\s*c\s*$/i],
  ['fatG', /^\s*\d+(?:\.\d+)?\s*g?\s*f\s*$/i],
];

export interface CaptionMacros {
  values: Partial<NutritionPerServing>;
  basis: 'per-serving' | 'total';
  /** Caption line indices consumed by the macro block. */
  lineIndices: number[];
  /** Trailing parenthetical of the "Macros Per X (…)" label line, if any. */
  yieldHint: string | null;
}

/**
 * The number belonging to a macro label — the one touching it, not the first in
 * the segment.
 *
 * "Macros per serving (1 cup rice per serving) (X3): 590 Calories" is why:
 * taking the first number read the portion note and reported the dish at
 * 1 calorie. Handles both orders, "590 Calories" and "Calories- 539".
 */
function numberNearLabel(segment: string, re: RegExp): number | null {
  const match = segment.match(re);
  if (!match || match.index === undefined) return null;
  const before = segment.slice(0, match.index);
  const after = segment.slice(match.index + match[0].length);
  const trailing = before.match(/(\d+(?:\.\d+)?)\s*(?:g|kcal|cal)?\s*$/i);
  if (trailing) return parseFloat(trailing[1]);
  const leading = after.match(/^\s*[:=\-–]?\s*(\d+(?:\.\d+)?)/);
  if (leading) return parseFloat(leading[1]);
  return null;
}

function readMacroKeys(line: string): Partial<NutritionPerServing> {
  const found: Partial<NutritionPerServing> = {};
  for (const segment of line.split(/[|•·,/]+/)) {
    for (const [key, re] of MACRO_LABELS) {
      if (found[key] !== undefined) continue;
      if (!re.test(segment)) continue;
      const value = numberNearLabel(segment, re);
      if (value === null) continue;
      found[key] = value;
    }
    // Only consulted when the spelled-out labels found nothing in this segment,
    // so "31g Protein" never reaches the far looser single-letter forms.
    for (const [key, re] of ABBREVIATED_MACRO_LABELS) {
      if (found[key] !== undefined) continue;
      if (!re.test(segment)) continue;
      const num = segment.match(NUMBER_RE);
      if (!num) continue;
      found[key] = parseFloat(num[0]);
    }
  }
  return found;
}

const MACRO_WORD = '(?:protein|carbs?|carbohydrates?|fat|calories|calorie|cals?|kcals?|p|c|f)';
/** "31g P", "51g Protein", "348 calories" — a quantity and a label, nothing else. */
const MACRO_SEGMENT_RE = new RegExp(
  `^\\s*(?:\\d+(?:\\.\\d+)?\\s*(?:g|kcal|cal)?\\s*${MACRO_WORD}|${MACRO_WORD}\\s*[:\\-]?\\s*\\d+(?:\\.\\d+)?\\s*g?)\\s*$`,
  'i',
);

/**
 * A line that is ENTIRELY macro data: "31g P | 43g C | 5g F".
 *
 * Separate from scanCaptionMacros, which finds the one block it will read
 * numbers from and stops. Creators routinely restate their macros — once in the
 * blurb, once under a "Calories & Macros" heading — and whichever the scanner
 * did not pick sits inside the ingredient region and becomes a grocery row
 * reading "31 g p | 43 g c | 5 g f".
 *
 * The two guards are what keep it safe. Every segment must be a bare
 * quantity-plus-label with nothing else, and there must be at least two of them,
 * so an ingredient carrying a macro word survives: "300g Low Fat Yogurt" is one
 * segment with extra words, and "100g Low Fat Protein Powder" fails on both
 * counts. Getting this wrong eats real ingredients — see the note on
 * scanCaptionMacros' calories rule.
 */
export function isPureMacroLine(line: string): boolean {
  const segments = stripEmoji(line)
    .split(/[|•·,/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length < 2) return false;
  return segments.every((s) => MACRO_SEGMENT_RE.test(s));
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
  // Blank lines are dropped from the working array but remembered, because
  // whether a line opens a block is the only thing separating a sub-recipe
  // heading from an unquantified ingredient ("Salt to taste"). The start of the
  // caption counts as a boundary.
  const rawLines: string[] = [];
  const opensBlock: boolean[] = [];
  let afterBlank = true;
  for (const line of caption.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      afterBlank = true;
      continue;
    }
    rawLines.push(trimmed);
    opensBlock.push(afterBlank);
    afterBlank = false;
  }
  if (rawLines.length === 0) {
    throw new RecipeParseError('not-found', 'The caption was empty.');
  }

  const headers = rawLines.map(detectHeader);
  const macros = scanCaptionMacros(rawLines);
  // The block the scanner read its numbers from, plus any OTHER line that is
  // pure macro data — a restated macro block must not become an ingredient.
  const macroLines = new Set(macros?.lineIndices ?? []);
  rawLines.forEach((line, i) => {
    if (isPureMacroLine(line)) macroLines.add(i);
  });
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
    // The run starts at the first ingredient, which leaves a sub-recipe heading
    // sitting directly above it just outside the region — so the block it names
    // comes out untagged. Reach back exactly one line to pick it up.
    //
    // Only when a title would survive it. With no ingredients header the title
    // is the first line before the region, and it is the same shape as a
    // heading — swallowing it leaves the recipe called "Untitled Recipe".
    const before = run.start - 1;
    const titleSurvives = rawLines
      .slice(0, Math.max(0, before))
      .some((_, i) => headers[i].type === null && !isNoise(i));
    const grabsHeading =
      before >= 0 &&
      titleSurvives &&
      headers[before].type === null &&
      !isNoise(before) &&
      opensBlock[before] &&
      subSectionLabel(rawLines[before]) !== null;
    region = grabsHeading ? { start: before, end: run.end } : run;
  }

  // One pass over the region. Ingredient lines are collected and tagged with the
  // sub-recipe title above them; anything else is kept in document order as
  // instructions, which is what recovers captions that interleave steps into the
  // ingredient sections.
  //
  // A title only becomes a section once an ingredient follows it (`pending` →
  // `current`), and an intervening prose line CANCELS it. That cancel is the
  // load-bearing rule: "Meal Prep Tip" is a three-word punctuation-free line,
  // indistinguishable from a real title by shape, but it is followed by a
  // paragraph. Every genuine title in the corpus is followed immediately by its
  // first ingredient.
  const ingredientIdxs: number[] = [];
  const ingredientSections: Array<string | undefined> = [];
  const regionProse: number[] = [];
  let pendingSection: string | null = null;
  let currentSection: string | undefined;
  let lastWasIngredient = false;
  for (let i = region.start; i < region.end; i++) {
    if (headers[i].type !== null || isNoise(i)) continue;

    // A heading has to OPEN a block: it follows a blank line, or sits directly
    // under the Ingredients header. Anything mid-run is part of the list, which
    // is what keeps "Salt to taste" an ingredient instead of a heading that
    // captures every line beneath it.
    const startsBlock = opensBlock[i] || headers[i - 1]?.type != null;
    const isIngredient =
      isIngredientLine(i) ||
      (!startsBlock && lastWasIngredient && looksLikeRunIngredient(rawLines[i]));

    if (isIngredient) {
      if (pendingSection !== null) {
        currentSection = pendingSection;
        pendingSection = null;
      }
      ingredientIdxs.push(i);
      ingredientSections.push(currentSection);
      lastWasIngredient = true;
      continue;
    }

    const label = startsBlock ? subSectionLabel(rawLines[i]) : null;
    if (label !== null) pendingSection = label;
    else {
      pendingSection = null;
      regionProse.push(i);
    }
    lastWasIngredient = false;
  }

  const ingredients: Ingredient[] = [];
  const sectionsInOrder: Array<string | undefined> = [];
  for (let k = 0; k < ingredientIdxs.length; k++) {
    const parsed = parseIngredient(
      truncateCommentary(stripAttribution(stripBullet(stripEmoji(rawLines[ingredientIdxs[k]])))),
    );
    if (parsed.name.trim().length === 0) continue;
    ingredients.push(parsed);
    sectionsInOrder.push(ingredientSections[k]);
  }

  // One section spanning the WHOLE list is a redundant header, not a split — tag
  // nothing rather than render a lone label over every ingredient. But a single
  // named block sitting under an unlabelled one ("…the main list…, Garlic
  // butter") does divide the list, so that keeps its label.
  const distinctSections = new Set(sectionsInOrder.filter((s): s is string => s !== undefined));
  const hasUntagged = sectionsInOrder.some((s) => s === undefined);
  if (distinctSections.size >= 2 || (distinctSections.size === 1 && hasUntagged)) {
    for (let k = 0; k < ingredients.length; k++) {
      if (sectionsInOrder[k] !== undefined) ingredients[k].section = sectionsInOrder[k];
    }
  }

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

  const methodIdxs: number[] = [];
  for (let i = Math.max(instrStart, region.end); i < instrEnd; i++) {
    if (headers[i].type === null && !isNoise(i)) methodIdxs.push(i);
  }

  // Where the ingredient-region prose lands depends on whether the caption has a
  // real method. With an explicit Instructions header the numbered steps ARE the
  // method and the region prose is an aside ("Let this marinate overnight if
  // possible") that has no business being step 1, so it goes last. Without one
  // the region prose *is* the method, and document order is the only order.
  const instructionIdxs =
    instrHeaderIdx >= 0 ? [...methodIdxs, ...regionProse] : [...regionProse, ...methodIdxs];
  const instructions = instructionIdxs
    .map((i) => stripBullet(stripEmoji(rawLines[i])))
    .filter((s) => s.length > 0);

  // Walk the lines above the ingredients and take the first that reduces to a
  // dish name. Not simply the first non-noise line: creators open with a hook
  // ("This is seriously one of the best appetizers I've ever made") and put the
  // dish name on the line below it.
  //
  // A line discarded as engagement bait gets a second look with the bait
  // removed, because "SAVE THIS ‼️ High Protein Street Corn Chicken Bowl" is
  // both at once and dropping the line loses the title.
  const titleBoundary = ingHeaderIdx >= 0 ? ingHeaderIdx : region.start;
  let title = 'Untitled Recipe';
  let fallbackTitle = '';
  for (let i = 0; i < titleBoundary; i++) {
    if (headers[i].type !== null) continue;
    const source = isNoise(i) ? stripCallToAction(stripEmoji(rawLines[i])) : rawLines[i];
    if (!source.trim()) continue;
    const candidate = cleanTitleLine(source);
    if (!candidate) continue;
    if (looksLikeCleanTitle(candidate)) {
      title = candidate;
      break;
    }
    // Nothing here reads as a dish name; remember the first attempt in case no
    // later line does any better.
    if (!fallbackTitle && !isNoise(i)) fallbackTitle = candidate;
  }
  if (title === 'Untitled Recipe' && fallbackTitle) title = fallbackTitle;

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
