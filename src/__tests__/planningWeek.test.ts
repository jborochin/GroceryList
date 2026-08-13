import {
  cellToDateKey,
  dateKeyLabel,
  dateKeyToCell,
  getSundayWeekStart,
  getWeekStart,
  parseDateKey,
  parseWeekStart,
  shiftDate,
  shiftWeek,
  toDateKey,
  todayKey,
  weekDateKeys,
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

describe('getSundayWeekStart', () => {
  it('returns the same Sunday for every day of the week', () => {
    // 2026-08-09 is a Sunday.
    for (let offset = 0; offset < 7; offset++) {
      expect(getSundayWeekStart(shiftDate('2026-08-09', offset))).toBe('2026-08-09');
    }
  });

  it('crosses month boundaries', () => {
    // 2026-08-01 is a Saturday; its Sunday-Saturday week starts Sun 2026-07-26.
    expect(getSundayWeekStart('2026-08-01')).toBe('2026-07-26');
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

// ---------------------------------------------------------------------------
// Day keys — the bridge between a single logged day and the schedule grid.
// ---------------------------------------------------------------------------

describe('parseDateKey / toDateKey', () => {
  it('round-trips a date key through local time', () => {
    expect(toDateKey(parseDateKey('2026-08-13'))).toBe('2026-08-13');
  });

  it('parses to local midnight, not UTC midnight', () => {
    // `new Date('2026-08-13')` is UTC midnight, which is the 12th anywhere west
    // of Greenwich — a late dinner would be filed under the wrong day.
    const d = parseDateKey('2026-08-13');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(13);
    expect(d.getHours()).toBe(0);
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('todayKey', () => {
  it('is the local date of the given instant', () => {
    expect(todayKey(new Date(2026, 7, 13, 23, 30))).toBe('2026-08-13');
  });
});

describe('shiftDate', () => {
  it('moves forward and backward by days', () => {
    expect(shiftDate('2026-08-13', 1)).toBe('2026-08-14');
    expect(shiftDate('2026-08-13', -1)).toBe('2026-08-12');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('dateKeyToCell', () => {
  it('indexes Monday as day 0 and Sunday as day 6', () => {
    // 2026-08-10 is a Monday.
    expect(dateKeyToCell('2026-08-10')).toEqual({ weekStart: '2026-08-10', day: 0 });
    expect(dateKeyToCell('2026-08-13')).toEqual({ weekStart: '2026-08-10', day: 3 });
    expect(dateKeyToCell('2026-08-16')).toEqual({ weekStart: '2026-08-10', day: 6 });
  });

  it('agrees with getWeekStart for every day of a week', () => {
    for (let i = 0; i < 7; i++) {
      const key = shiftDate('2026-08-10', i);
      const cell = dateKeyToCell(key);
      expect(cell.weekStart).toBe(getWeekStart(parseDateKey(key)));
      expect(cell.day).toBe(i);
    }
  });
});

describe('cellToDateKey', () => {
  it('inverts dateKeyToCell', () => {
    for (let i = 0; i < 7; i++) {
      const key = shiftDate('2026-08-10', i);
      const { weekStart, day } = dateKeyToCell(key);
      expect(cellToDateKey(weekStart, day)).toBe(key);
    }
  });
});

describe('weekDateKeys', () => {
  it('lists the seven days of a week, Monday first', () => {
    expect(weekDateKeys('2026-08-10')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });
});

describe('dateKeyLabel', () => {
  const today = new Date(2026, 7, 13);

  it('names the days around today', () => {
    expect(dateKeyLabel('2026-08-13', today)).toBe('Today');
    expect(dateKeyLabel('2026-08-12', today)).toBe('Yesterday');
    expect(dateKeyLabel('2026-08-14', today)).toBe('Tomorrow');
  });

  it('falls back to a weekday and date', () => {
    expect(dateKeyLabel('2026-08-17', today)).toBe('Mon, Aug 17');
  });
});
