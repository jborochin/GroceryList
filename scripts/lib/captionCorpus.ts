/**
 * Shared plumbing for the caption corpus: locating saved captions, reducing a
 * parse to a diffable digest, and flagging output that looks wrong.
 *
 * Used by `ig:harvest`, `ig:audit`, and the snapshot test. Kept in scripts/
 * because none of it ships in the app.
 *
 * The idea behind the smells is that you cannot hand-write expected output for
 * hundreds of captions, but you *can* recognise output that is wrong without
 * knowing what right looks like. A digit surviving into an ingredient name is
 * a quantity the parser failed to lift; an ` & ` between two nouns is usually
 * two ingredients on one line. Review the flagged rows, fix the class, move on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ingredient } from '../../src/types';
import { parseIngredient } from '../../src/utils/ingredientParser';
import { parseRecipeFromCaption } from '../../src/utils/instagramCaptionParser';
import { toSections } from '../../src/utils/ingredientSections';
import { findPrice } from '../../src/utils/priceLookup';
import { toPurchasableName } from '../../src/utils/purchasableName';
import { getFamily } from '../../src/utils/unitConversion';
import { RecipeParseError } from '../../src/utils/recipeUrlParser';

export const FIXTURE_ROOT = path.join(
  __dirname,
  '..',
  '..',
  'src',
  '__tests__',
  'fixtures',
  'instagram',
);
export const CAPTION_DIR = path.join(FIXTURE_ROOT, 'captions');
export const MANIFEST_PATH = path.join(FIXTURE_ROOT, 'captions.manifest.json');
export const BASELINE_PATH = path.join(FIXTURE_ROOT, 'parseBaseline.json');

/** Where a caption came from. Kept out of the .txt files so those stay verbatim. */
export interface ManifestEntry {
  shortcode: string;
  url: string;
  /** Set instead of `fixture` when the fetch or parse failed — a record of what was tried. */
  fixture?: string;
  failure?: string;
}

export type Manifest = Record<string, ManifestEntry>;

export function readManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

export function writeManifest(manifest: Manifest): void {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

export function listCaptions(): string[] {
  if (!fs.existsSync(CAPTION_DIR)) return [];
  return fs
    .readdirSync(CAPTION_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort();
}

export function readCaption(name: string): string {
  return fs.readFileSync(path.join(CAPTION_DIR, `${name}.txt`), 'utf8');
}

// ---------------------------------------------------------------------------
// Digest — the snapshot unit
// ---------------------------------------------------------------------------

/**
 * A caption's parse, flattened to strings.
 *
 * Deliberately human-readable rather than a faithful object dump: the whole
 * point of the baseline is that `git diff` shows you what a parser change did,
 * so an ingredient reads as "1200 g raw boneless chicken thighs [Marinade]"
 * instead of three JSON lines.
 */
export interface CaptionDigest {
  title: string;
  servings: number;
  macros: string;
  sections: string[];
  ingredients: string[];
  instructions: string[];
  /** Set instead of everything else when the caption does not parse at all. */
  error?: string;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function formatIngredient(ing: Ingredient): string {
  const qty = `${formatQuantity(ing.quantity)} ${ing.unit}`;
  return `${qty} ${ing.name}${ing.section ? `  [${ing.section}]` : ''}`;
}

/**
 * A caption's parse in both forms: the digest that goes in the baseline, and the
 * structured recipe the smells inspect. The smells work on real Ingredient
 * objects rather than re-parsing the digest strings — a detector that has to
 * take its own formatting apart again will eventually disagree with itself.
 */
export interface CaptionAnalysis {
  caption: string;
  digest: CaptionDigest;
  ingredients: Ingredient[];
  instructions: string[];
  servings: number;
  title: string;
}

export function analyzeCaption(text: string): CaptionAnalysis {
  const digest = digestCaption(text);
  let ingredients: Ingredient[] = [];
  let instructions: string[] = [];
  let servings = 0;
  let title = '';
  if (!digest.error) {
    const recipe = parseRecipeFromCaption(text);
    ingredients = recipe.ingredients;
    instructions = recipe.instructions ?? [];
    servings = recipe.servings;
    title = recipe.title;
  }
  return { caption: text, digest, ingredients, instructions, servings, title };
}

export function digestCaption(text: string): CaptionDigest {
  let recipe;
  try {
    recipe = parseRecipeFromCaption(text);
  } catch (err) {
    // A caption with no ingredient list is a routine outcome — roughly one reel
    // in three. It still belongs in the baseline: if a parser change starts or
    // stops recovering one, that is exactly what we want the diff to show.
    const kind = err instanceof RecipeParseError ? err.kind : 'unknown';
    return {
      title: '',
      servings: 0,
      macros: '',
      sections: [],
      ingredients: [],
      instructions: [],
      error: `${kind}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const n = recipe.nutritionPerServing;
  return {
    title: recipe.title,
    servings: recipe.servings,
    macros: n ? `${n.calories} cal | ${n.proteinG}p | ${n.carbsG}c | ${n.fatG}f` : '(none)',
    sections: toSections(recipe.ingredients)
      .map((s) => s.title)
      .filter((t): t is string => !!t),
    ingredients: recipe.ingredients.map(formatIngredient),
    instructions: recipe.instructions ?? [],
  };
}

export type Baseline = Record<string, CaptionDigest>;

export function buildBaseline(): Baseline {
  const out: Baseline = {};
  for (const name of listCaptions()) out[name] = digestCaption(readCaption(name));
  return out;
}

export function readBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

export function writeBaseline(baseline: Baseline): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Smells
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warn';

export interface Smell {
  smell: string;
  severity: Severity;
  detail: string;
  /** One line explaining what a human should look for. */
  hint: string;
}

const MEASURED_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp']);

const IMPERATIVE_START =
  /^(?:cook|bake|air fry|mix|preheat|marinate|serve|season|add|oven|spread|store|keep|let|slice|dip|toss|microwave|whisk|pour|place|blend|heat|fry|grill|stir|drizzle|sprinkle|garnish|chop|remove|transfer|boil|simmer|roast|broil|refrigerate|chill|repeat|assemble|fold|coat|cover|bring|reserve)\b/i;

const MAX_REASONABLE_NAME = 45;

// Digits that legitimately belong inside a product name or a prep note, and so
// are NOT evidence of a quantity the parser dropped: "80/20 ground beef",
// "5% fat", "cut into 1-2 inch cubes", "for 3-4 minutes".
const INNOCENT_DIGITS =
  /\d+\s*%|\d{2,}\s*\/\s*\d{2,}|\d+(?:\s*-\s*\d+)?\s*(?:inch|inches|in\b|cm|mm|minutes?|mins?|hours?|hrs?|seconds?|secs?)/gi;

/**
 * A title should be a dish name. Creators routinely open with a marketing
 * sentence instead ("If you need an easy dinner recipe using a pound of ground
 * beef, this Sloppy Joe Potato Skillet won't disappoint!"), and the parser takes
 * the first non-noise line, so the blurb wins. Length is the cheapest tell.
 */
// Set by real dish names, which run long: "Easy High Protein Honey BBQ Chicken
// Mac & Cheese" is 9 words and 47 chars and is genuinely the title. Blurbs are
// far longer than that, so a tight cap only manufactures false positives.
const MAX_TITLE_WORDS = 10;
const MAX_TITLE_CHARS = 60;
/** Punctuation *followed by a space* — a dish name has none; a sentence does.
 *  A trailing "!" is just enthusiasm and must not count. */
const MID_SENTENCE_PUNCT = /[.!?,]\s/;

/** Does the caption state a yield anywhere? Mirrors what the servings tiers look for. */
const STATES_A_YIELD = /\b(?:serves|serving for|makes|yields?|to make)\s+(?:about\s+|approximately\s+|around\s+)?\d|\d+\s+servings?\b/i;

/**
 * Flag output that looks wrong, without knowing what right looks like.
 *
 * `error` means the row is almost certainly broken and a user would see it.
 * `warn` means worth a human glance — some are legitimate (a "5% fat" beef
 * really does carry a digit).
 */
export function smellsFor(analysis: CaptionAnalysis): Smell[] {
  const found: Smell[] = [];
  const flag = (smell: string, severity: Severity, detail: string, hint: string) =>
    found.push({ smell, severity, detail, hint });

  if (analysis.digest.error) return found; // a non-parse is reported separately, not smelled

  if (analysis.title === 'Untitled Recipe') {
    flag('no-title', 'error', '(none)', 'No line before the ingredients survived as a title.');
  } else if (
    analysis.title.split(/\s+/).length > MAX_TITLE_WORDS ||
    analysis.title.length > MAX_TITLE_CHARS ||
    MID_SENTENCE_PUNCT.test(analysis.title)
  ) {
    // Sentence punctuation is as strong a tell as length: a dish name has none.
    flag('title-is-a-blurb', 'error', analysis.title, 'The opening marketing line was taken as the title.');
  }

  for (const ing of analysis.ingredients) {
    const name = ing.name;
    const line = formatIngredient(ing);

    // A digit inside the NAME is a quantity the parser failed to lift out —
    // usually a second ingredient glued on, or a mangled mixed fraction. Digits
    // that belong to the product or a prep note are masked out first, or the
    // class fills with "80/20 ground beef" and stops being worth reading.
    if (/\d/.test(name.replace(INNOCENT_DIGITS, ''))) {
      flag('quantity-in-name', 'error', line, 'A number left in the name means a lost quantity.');
    }
    if (/^(?:and|or|plus|&|to|of)\b/i.test(name)) {
      flag('leading-connective', 'error', line, 'The name starts mid-phrase — the quantity was cut wrong.');
    }
    if (/\S\s+(?:&|\+)\s+\S/.test(name) || /\S,?\s+and\s+\S/.test(name)) {
      flag('two-in-one', 'warn', line, 'Looks like two ingredients on one line.');
    }
    if (!getFamily(ing.unit)) {
      flag('unknown-unit', 'error', line, 'Unit has no family — it renders raw and cannot be summed.');
    }
    if (IMPERATIVE_START.test(name)) {
      flag('ingredient-looks-like-step', 'error', line, 'An instruction leaked into the ingredient list.');
    }
    if (name.length > MAX_REASONABLE_NAME) {
      flag('long-name', 'warn', `${name.length} chars :: ${line}`, 'Prep notes probably belong in the step.');
    }
    if (/,\s*(?:garnish|to taste|optional|heavy pass|for serving|divided)\b/i.test(name)) {
      flag('note-in-name', 'warn', line, 'A serving note is riding along onto the grocery list.');
    }
    if (!findPrice(toPurchasableName(name))) {
      flag('unpriceable', 'warn', toPurchasableName(name), 'No price row — this item shows a gap on the list.');
    }
  }

  for (const step of analysis.instructions) {
    const parsed = parseIngredient(step);
    if (parsed.quantity !== 1 || MEASURED_UNITS.has(parsed.unit)) {
      flag('step-looks-measured', 'error', step.slice(0, 70), 'An ingredient leaked into the method.');
    }
  }

  if (analysis.instructions.length === 0) {
    flag('no-instructions', 'warn', '(none)', 'Nothing was recovered as a method.');
  }
  // 4 is parseCaptionServings' fallback. Only worth flagging when the caption
  // never stated a yield at all — plenty of recipes genuinely serve four, and
  // flagging those buries the real misses.
  if (analysis.servings === 4 && !STATES_A_YIELD.test(analysis.caption)) {
    flag('default-servings', 'warn', 'servings=4', 'No yield found in the caption; 4 is the fallback.');
  }

  return found;
}
