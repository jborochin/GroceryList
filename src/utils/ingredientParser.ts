import { Ingredient } from '../types';
import unitSynonyms from '../data/unitSynonyms.json';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const SYNONYM_LOOKUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(unitSynonyms as Record<string, string[]>)) {
    for (const alias of aliases) {
      map[alias.toLowerCase()] = canonical;
    }
  }
  return map;
})();

const STOP_WORDS = new Set(['of', 'the', 'a', 'an']);

// Instagram captions (and plenty of recipe sites) glue the quantity to the unit:
// "300g pasta", "1tbs paprika", "1/2tbs oregano". extractQuantity tokenizes on
// spaces, so "300g" matches no numeric pattern and the whole line falls through
// as `1 each :: 300g pasta` — unpriceable and un-aggregatable.
//
// The split is driven by the alias table itself, longest alias first, so a digit
// is only ever separated from a *real* unit. That gate is what keeps "9x13",
// "7up", "350f" and "1st" intact — not the length of the letter run.
//
// Known and accepted false positive: "180c" → "180 cup", because "c" is a cup
// alias. Oven temperatures live in instructions, not ingredient lines, so this
// costs nothing in the pipeline.
const GLUED_UNIT_RE = (() => {
  const singleWordAliases = Object.keys(SYNONYM_LOOKUP)
    .filter((alias) => /^[a-z]+$/.test(alias))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(\\d)(${singleWordAliases.join('|')})(?=[\\s,;:]|$)`, 'g');
})();

/**
 * Separate a quantity from a unit glued onto it ("300g" → "300 g"). Operates on
 * already-lowercased text, so the pattern needs no case-insensitive flag.
 */
export function splitGluedUnits(text: string): string {
  return text.replace(GLUED_UNIT_RE, '$1 $2');
}

/**
 * Map a free-typed unit to its canonical form (e.g. "lbs" → "lb", "cups" → "cup").
 * Unknown units are returned lowercased/trimmed so they survive as display-only labels.
 * An empty unit defaults to "each".
 */
export function canonicalizeUnit(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, '');
  if (!u) return 'each';
  return SYNONYM_LOOKUP[u] ?? u;
}

export function parseIngredient(raw: string): Ingredient {
  const original = raw.trim();
  if (!original) return { name: '', quantity: 0, unit: 'each', raw: original };

  let text = original.toLowerCase();

  // Strip parentheticals: "(14-oz)", nested "(a (b))", and dangling brackets
  let prev: string;
  do {
    prev = text;
    text = text.replace(/\([^()]*\)/g, ' ');
  } while (text !== prev);
  text = text.replace(/[()[\]{}]/g, ' ');

  // Replace unicode fractions: "1½" → "1 0.5", " ½" → " 0.5"
  text = Array.from(text).map((ch) => {
    const v = UNICODE_FRACTIONS[ch];
    return v !== undefined ? ` ${v} ` : ch;
  }).join('');

  // Tighten ranges so "1 - 2" / "1 – 2" tokenize as a single "1-2" token
  text = text.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1-$2');

  text = text.replace(/\s+/g, ' ').trim();

  // Unglue "300g" → "300 g" before tokenizing, or extractQuantity finds no number.
  text = splitGluedUnits(text);

  // Short-circuit "to taste" / "as needed" / "pinch of X" (tolerate ", to taste")
  const tailMatch = text.match(/^(.*?)(?:[,;]\s*|\s+)(?:to\s+taste|as\s+needed)$/);
  if (tailMatch) text = tailMatch[1].trim();

  // Try to extract quantity (mixed fraction, simple fraction, decimal, integer, or sum of partials like "1 0.5" from unicode expansion)
  const quantity = extractQuantity(text);
  let rest = quantity.remainder;

  // Drop separator words after qty
  rest = rest.replace(/^(?:of\s+)/, '').trim();

  // Match unit from synonym table (longest alias first)
  const unit = extractUnit(rest);

  let name = unit.remainder.trim();
  name = name.replace(/^(?:of\s+)/, '').trim();
  name = name.replace(/[.,;:]+$/g, '').trim();

  // Drop leading stop words
  const tokens = name.split(/\s+/).filter((t) => !STOP_WORDS.has(t));
  name = tokens.join(' ').trim();

  if (!name) {
    return { name: original, quantity: 1, unit: 'each', raw: original };
  }

  return {
    name,
    quantity: quantity.value > 0 ? quantity.value : 1,
    unit: unit.canonical ?? 'each',
    raw: original,
  };
}

interface QtyExtract {
  value: number;
  remainder: string;
}

function extractQuantity(text: string): QtyExtract {
  const original = text;
  let value = 0;
  let consumed = 0;
  const tokens = text.split(' ');
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) {
      i++;
      continue;
    }
    // Range like "1-2" / "1.5-2" / "1/2-3/4": use the average of the bounds
    const rangeMatch = tok.match(/^(\d+(?:\.\d+)?|\d+\/\d+)-(\d+(?:\.\d+)?|\d+\/\d+)$/);
    if (rangeMatch) {
      const lo = numericToken(rangeMatch[1]);
      const hi = numericToken(rangeMatch[2]);
      if (lo !== null && hi !== null) {
        value += (lo + hi) / 2;
        consumed = i + 1;
        i++;
        continue;
      }
    }
    // Mixed like "1 1/2": next token is a simple fraction
    if (/^\d+$/.test(tok) && i + 1 < tokens.length && /^\d+\/\d+$/.test(tokens[i + 1])) {
      value += Number(tok) + parseFraction(tokens[i + 1]);
      consumed = i + 2;
      i += 2;
      continue;
    }
    if (/^\d+\/\d+$/.test(tok)) {
      value += parseFraction(tok);
      consumed = i + 1;
      i++;
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      value += Number(tok);
      consumed = i + 1;
      i++;
      continue;
    }
    // Word range like "3 to 4": average what we have with the upper bound
    if (tok === 'to' && consumed > 0 && i + 1 < tokens.length) {
      const hi = numericToken(tokens[i + 1]);
      if (hi !== null) {
        value = (value + hi) / 2;
        consumed = i + 2;
      }
    }
    break;
  }

  if (consumed === 0) return { value: 0, remainder: original };
  return { value, remainder: tokens.slice(consumed).join(' ') };
}

function parseFraction(s: string): number {
  const [n, d] = s.split('/').map(Number);
  if (!d) return 0;
  return n / d;
}

function numericToken(tok: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(tok)) return Number(tok);
  if (/^\d+\/\d+$/.test(tok)) return parseFraction(tok);
  return null;
}

interface UnitExtract {
  canonical: string | null;
  remainder: string;
}

function extractUnit(text: string): UnitExtract {
  if (!text) return { canonical: null, remainder: '' };
  const tokens = text.split(' ');

  // Try 2-word then 1-word aliases (handles "fl oz")
  for (const len of [2, 1]) {
    if (tokens.length < len) continue;
    const candidate = tokens.slice(0, len).join(' ');
    const canonical = SYNONYM_LOOKUP[candidate];
    if (canonical) {
      return { canonical, remainder: tokens.slice(len).join(' ') };
    }
  }

  // Handle trailing period: "tbsp." form
  const first = tokens[0].replace(/\.$/, '');
  if (SYNONYM_LOOKUP[first]) {
    return { canonical: SYNONYM_LOOKUP[first], remainder: tokens.slice(1).join(' ') };
  }

  return { canonical: null, remainder: text };
}
