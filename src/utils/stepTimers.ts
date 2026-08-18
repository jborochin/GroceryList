// Lift cooking timers out of instruction prose. "Simmer for 20 minutes" becomes
// a tappable 20-minute chip on that step, so cook mode never sends you to a
// separate timer app.
//
// The parser is deliberately conservative: a bare number is never a duration.
// "Preheat to 350" and "add 2 tablespoons" must produce nothing, because a
// wrong chip is worse than a missing one — the user can still add a timer by
// hand, but a phantom 350-minute timer is just noise on every recipe.

export interface ParsedDuration {
  /** What the timer counts down. For a range, the LOWER bound — check early rather than burn. */
  seconds: number;
  /** Chip text: '20 min', '1 hr 30 min', '8–10 min'. */
  label: string;
}

/** Never offer a timer longer than this — "refrigerate 24 hours" is a plan, not a timer. */
const MAX_SECONDS = 12 * 60 * 60;

/** Steps like "rest 1 min, cook 5 min, rest 10 min…" would otherwise fill the row. */
const MAX_PER_STEP = 3;

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
};

// Ordered longest-first so "1 1/2" wins over "1", and "1½" over a bare "1".
const NUM = String.raw`\d+(?:\.\d+)?\s*[½⅓⅔¼¾]|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾]`;
const UNIT = String.raw`hours?|hrs?|minutes?|mins?|seconds?|secs?`;
const RANGE = String.raw`\s*(?:-|–|—|to|or)\s*`;

const DURATION = new RegExp(
  `(${NUM})(?:${RANGE}(${NUM}))?\\s*(${UNIT})\\b`,
  'gi'
);

/** Only whitespace, a comma, or "and" may sit between the halves of "1 hour 30 minutes". */
const JOINABLE_GAP = /^[\s,]*(?:and\s*)?$/i;

type UnitKey = 'hour' | 'minute' | 'second';

const UNIT_SECONDS: Record<UnitKey, number> = { hour: 3600, minute: 60, second: 1 };
const UNIT_SHORT: Record<UnitKey, string> = { hour: 'hr', minute: 'min', second: 'sec' };

interface Match {
  lower: number; // seconds
  upper: number | null; // seconds, when the text gave a range
  unit: UnitKey;
  start: number;
  end: number;
}

/**
 * Every timer offered by one instruction step, in the order they are written.
 * Returns `[]` when the step names no duration — most steps don't.
 */
export function parseStepDurations(step: string): ParsedDuration[] {
  if (!step || !step.trim()) return [];

  const matches = scan(step);
  const merged = mergeCompounds(matches, step);

  const out: ParsedDuration[] = [];
  const seen = new Set<number>();
  for (const m of merged) {
    if (m.lower <= 0 || m.lower > MAX_SECONDS) continue;
    if (seen.has(m.lower)) continue;
    seen.add(m.lower);
    out.push({ seconds: m.lower, label: labelFor(m) });
    if (out.length === MAX_PER_STEP) break;
  }
  return out;
}

function scan(step: string): Match[] {
  const matches: Match[] = [];
  DURATION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DURATION.exec(step)) !== null) {
    const unit = unitKey(m[3]);
    if (!unit) continue;
    const per = UNIT_SECONDS[unit];
    const lower = parseAmount(m[1]);
    if (lower === null) continue;
    const upperRaw = m[2] ? parseAmount(m[2]) : null;
    matches.push({
      lower: Math.round(lower * per),
      upper: upperRaw === null ? null : Math.round(upperRaw * per),
      unit,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return matches;
}

/**
 * Fold "1 hour 30 minutes" into a single 5400s timer. Only descending unit
 * order joins — "30 minutes, then bake 2 hours" is two separate timers, and
 * treating it as one would silently swallow the first.
 */
function mergeCompounds(matches: Match[], step: string): Match[] {
  const out: Match[] = [];
  for (const next of matches) {
    const prev = out[out.length - 1];
    const joinable =
      prev !== undefined &&
      rank(next.unit) < rank(prev.unit) &&
      JOINABLE_GAP.test(step.slice(prev.end, next.start));
    if (joinable) {
      out[out.length - 1] = {
        ...prev,
        lower: prev.lower + next.lower,
        upper: prev.upper === null && next.upper === null ? null : sumUpper(prev, next),
        end: next.end,
      };
      continue;
    }
    out.push(next);
  }
  return out;
}

function sumUpper(a: Match, b: Match): number {
  return (a.upper ?? a.lower) + (b.upper ?? b.lower);
}

/** Larger unit = higher rank, so "hour then minute" joins but "minute then hour" doesn't. */
function rank(unit: UnitKey): number {
  return unit === 'hour' ? 2 : unit === 'minute' ? 1 : 0;
}

function unitKey(raw: string): UnitKey | null {
  const u = raw.toLowerCase();
  if (u.startsWith('h')) return 'hour';
  if (u.startsWith('m')) return 'minute';
  if (u.startsWith('s')) return 'second';
  return null;
}

/** '1 1/2' | '1½' | '1/2' | '½' | '2.5' | '20' → a number, or null if unreadable. */
function parseAmount(raw: string): number | null {
  const text = raw.trim();

  const unicode = text.match(/^(\d+(?:\.\d+)?)?\s*([½⅓⅔¼¾])$/);
  if (unicode) {
    const whole = unicode[1] ? parseFloat(unicode[1]) : 0;
    return whole + UNICODE_FRACTIONS[unicode[2]];
  }

  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const denom = parseInt(mixed[3], 10);
    if (denom === 0) return null;
    return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / denom;
  }

  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const denom = parseInt(fraction[2], 10);
    if (denom === 0) return null;
    return parseInt(fraction[1], 10) / denom;
  }

  const plain = parseFloat(text);
  return Number.isFinite(plain) ? plain : null;
}

function labelFor(m: Match): string {
  if (m.upper !== null && m.upper !== m.lower) {
    const per = UNIT_SECONDS[m.unit];
    return `${trim(m.lower / per)}–${trim(m.upper / per)} ${UNIT_SHORT[m.unit]}`;
  }
  return formatDurationLabel(m.lower);
}

/** '90' → '1 min 30 sec'; '5400' → '1 hr 30 min'. Seconds are dropped once hours are involved. */
export function formatDurationLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secs > 0 && hours === 0) parts.push(`${secs} sec`);
  return parts.length > 0 ? parts.join(' ') : '0 sec';
}

/** Drop a trailing '.0' so a range reads '8–10 min', not '8.0–10.0 min'. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}
