// Week anchoring for the meal-plan calendar. A "week key" is the ISO local date
// (YYYY-MM-DD) of the week's Monday; string equality/ordering therefore matches
// week equality/ordering. All math is done in local time on purpose — the plan
// belongs to the user's wall-calendar week, not UTC's.

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Monday (local) of the week containing `d`, as a week key. */
export function getWeekStart(d: Date = new Date()): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return toKey(monday);
}

/** Local-midnight Date for a week key. */
export function parseWeekStart(weekStart: string): Date {
  return parseDateKey(weekStart);
}

/**
 * Sunday (local) of the calendar week containing `dateKey`, as a date key.
 * Distinct from `getWeekStart` (Monday-anchored, drives the schedule grid) —
 * this is the Sunday-Saturday week the Log tab's day strip displays.
 */
export function getSundayWeekStart(dateKey: string): string {
  const d = parseDateKey(dateKey);
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return toKey(sunday);
}

// ---------------------------------------------------------------------------
// Day keys
//
// The food log addresses single days, not weeks, but the two must agree: the
// Log tab projects a day's planned meals out of the same schedule grid the Week
// view edits. A "date key" is the same YYYY-MM-DD local-date format as a week
// key — dateKeyToCell is the bridge between them.
//
// Everything here is local-time on purpose. `new Date('2026-08-12')` parses as
// UTC midnight and lands on the 11th anywhere west of Greenwich, which would
// file a late dinner under the wrong day.
// ---------------------------------------------------------------------------

/** Local-midnight Date for any date key. */
export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date key for a Date, in local time. */
export function toDateKey(d: Date): string {
  return toKey(d);
}

/** Today's date key, in local time. */
export function todayKey(today: Date = new Date()): string {
  return toKey(today);
}

/** The date key `days` days after (negative: before) `dateKey`. */
export function shiftDate(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

/**
 * Address a date within the schedule grid: which week it belongs to, and which
 * column (0 = Monday) it occupies. This is how a day's ScheduleCells are found.
 */
export function dateKeyToCell(dateKey: string): { weekStart: string; day: number } {
  const d = parseDateKey(dateKey);
  return { weekStart: getWeekStart(d), day: (d.getDay() + 6) % 7 };
}

/** The inverse of dateKeyToCell: the date key of day `day` in `weekStart`. */
export function cellToDateKey(weekStart: string, day: number): string {
  return shiftDate(weekStart, day);
}

/** The seven date keys of a week, Monday first. */
export function weekDateKeys(weekStart: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => shiftDate(weekStart, i));
}

/** 'Today' / 'Yesterday' / 'Tomorrow', else 'Thu, Aug 14'. */
export function dateKeyLabel(dateKey: string, today: Date = new Date()): string {
  const current = todayKey(today);
  if (dateKey === current) return 'Today';
  if (dateKey === shiftDate(current, -1)) return 'Yesterday';
  if (dateKey === shiftDate(current, 1)) return 'Tomorrow';
  const d = parseDateKey(dateKey);
  return `${WEEKDAY_SHORT[(d.getDay() + 6) % 7]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The week key `weeks` whole weeks after (negative: before) `weekStart`. */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = parseWeekStart(weekStart);
  d.setDate(d.getDate() + weeks * 7);
  return toKey(d);
}

/** 'This week' / 'Next week' / 'Last week', else 'Week of Jul 20'. */
export function weekLabel(weekStart: string, today: Date = new Date()): string {
  const current = getWeekStart(today);
  if (weekStart === current) return 'This week';
  if (weekStart === shiftWeek(current, 1)) return 'Next week';
  if (weekStart === shiftWeek(current, -1)) return 'Last week';
  const d = parseWeekStart(weekStart);
  return `Week of ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** 'Jul 20 – 26', or 'Jun 29 – Jul 5' when the week spans two months. */
export function weekRangeLabel(weekStart: string): string {
  const start = parseWeekStart(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const from = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}`;
  const to =
    end.getMonth() === start.getMonth()
      ? `${end.getDate()}`
      : `${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
  return `${from} – ${to}`;
}
