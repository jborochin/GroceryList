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
  const [y, m, d] = weekStart.split('-').map(Number);
  return new Date(y, m - 1, d);
}

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
