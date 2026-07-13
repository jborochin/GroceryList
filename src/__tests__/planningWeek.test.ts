import {
  getWeekStart,
  parseWeekStart,
  shiftWeek,
  weekLabel,
  weekRangeLabel,
} from '../utils/planningWeek';

describe('getWeekStart', () => {
  it('returns the same Monday for every day of the week', () => {
    // 2026-07-06 is a Monday.
    for (let offset = 0; offset < 7; offset++) {
      expect(getWeekStart(new Date(2026, 6, 6 + offset))).toBe('2026-07-06');
    }
  });

  it('anchors a Sunday to the preceding Monday', () => {
    // 2026-07-12 is a Sunday.
    expect(getWeekStart(new Date(2026, 6, 12))).toBe('2026-07-06');
  });

  it('crosses month boundaries', () => {
    // 2026-08-01 is a Saturday; its week starts Mon 2026-07-27.
    expect(getWeekStart(new Date(2026, 7, 1))).toBe('2026-07-27');
  });

  it('crosses year boundaries', () => {
    // 2026-01-01 is a Thursday; its week starts Mon 2025-12-29.
    expect(getWeekStart(new Date(2026, 0, 1))).toBe('2025-12-29');
  });
});

describe('parseWeekStart', () => {
  it('round-trips with getWeekStart', () => {
    const d = parseWeekStart('2026-07-06');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(6);
    expect(getWeekStart(d)).toBe('2026-07-06');
  });
});

describe('shiftWeek', () => {
  it('moves forward and backward by whole weeks', () => {
    expect(shiftWeek('2026-07-06', 1)).toBe('2026-07-13');
    expect(shiftWeek('2026-07-06', -1)).toBe('2026-06-29');
    expect(shiftWeek('2026-07-06', 4)).toBe('2026-08-03');
  });

  it('week keys stay string-comparable in chronological order', () => {
    expect(shiftWeek('2026-07-06', 1) > '2026-07-06').toBe(true);
    expect(shiftWeek('2026-07-06', -1) < '2026-07-06').toBe(true);
  });
});

describe('weekLabel', () => {
  const today = new Date(2026, 6, 8); // Wed of week 2026-07-06

  it('names the adjacent weeks', () => {
    expect(weekLabel('2026-07-06', today)).toBe('This week');
    expect(weekLabel('2026-07-13', today)).toBe('Next week');
    expect(weekLabel('2026-06-29', today)).toBe('Last week');
  });

  it('falls back to a dated label further out', () => {
    expect(weekLabel('2026-07-20', today)).toBe('Week of Jul 20');
    expect(weekLabel('2026-06-22', today)).toBe('Week of Jun 22');
  });
});

describe('weekRangeLabel', () => {
  it('collapses the month when the week stays inside one', () => {
    expect(weekRangeLabel('2026-07-06')).toBe('Jul 6 – 12');
  });

  it('spells both months when the week spans two', () => {
    expect(weekRangeLabel('2026-06-29')).toBe('Jun 29 – Jul 5');
  });
});
