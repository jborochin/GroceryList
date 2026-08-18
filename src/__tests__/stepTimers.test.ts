import { parseStepDurations } from '../utils/stepTimers';

describe('parseStepDurations', () => {
  const seconds = (step: string) => parseStepDurations(step).map((d) => d.seconds);

  describe('single durations', () => {
    it('reads minutes', () => {
      expect(parseStepDurations('Simmer for 20 minutes, stirring occasionally.')).toEqual([
        { seconds: 1200, label: '20 min' },
      ]);
    });

    it('reads the abbreviated forms', () => {
      expect(seconds('Boil for 10 mins.')).toEqual([600]);
      expect(seconds('Boil for 10 min.')).toEqual([600]);
    });

    it('reads hours', () => {
      expect(parseStepDurations('Bake for 1 hour.')).toEqual([{ seconds: 3600, label: '1 hr' }]);
      expect(seconds('Braise for 2 hrs.')).toEqual([7200]);
    });

    it('reads seconds', () => {
      expect(parseStepDurations('Blanch for 30 seconds.')).toEqual([
        { seconds: 30, label: '30 sec' },
      ]);
      expect(seconds('Pulse for 45 secs.')).toEqual([45]);
    });
  });

  describe('compound durations', () => {
    it('combines an hour and minutes into one timer', () => {
      expect(parseStepDurations('Roast for 1 hour 30 minutes.')).toEqual([
        { seconds: 5400, label: '1 hr 30 min' },
      ]);
    });

    it('combines across an "and"', () => {
      expect(seconds('Cook for 2 hours and 15 minutes.')).toEqual([8100]);
    });

    it('does not combine when the second unit is larger', () => {
      expect(seconds('Chill 30 minutes, then bake 2 hours.')).toEqual([1800, 7200]);
    });
  });

  describe('ranges', () => {
    it('takes the lower bound so you check before it burns', () => {
      expect(parseStepDurations('Sear for 8 to 10 minutes.')).toEqual([
        { seconds: 480, label: '8–10 min' },
      ]);
    });

    it('accepts hyphen and en-dash separators', () => {
      expect(seconds('Sear for 8-10 minutes.')).toEqual([480]);
      expect(seconds('Sear for 8–10 minutes.')).toEqual([480]);
    });
  });

  describe('fractions', () => {
    it('reads a written mixed number', () => {
      expect(seconds('Simmer 1 1/2 hours.')).toEqual([5400]);
    });

    it('reads a unicode mixed number', () => {
      expect(seconds('Simmer 1½ hours.')).toEqual([5400]);
    });

    it('reads a bare fraction', () => {
      expect(seconds('Rest 1/2 hour.')).toEqual([1800]);
    });
  });

  describe('things that are not durations', () => {
    it('ignores oven temperatures', () => {
      expect(parseStepDurations('Preheat the oven to 350°F.')).toEqual([]);
      expect(parseStepDurations('Preheat the oven to 400 degrees.')).toEqual([]);
    });

    it('ignores measurements', () => {
      expect(parseStepDurations('Add 2 tablespoons of olive oil.')).toEqual([]);
    });

    it('ignores a bare number with no time unit', () => {
      expect(parseStepDurations('Repeat with the remaining 3 tortillas.')).toEqual([]);
    });

    it('ignores overnight and other non-timer waits', () => {
      expect(parseStepDurations('Marinate overnight.')).toEqual([]);
    });

    it('ignores waits longer than 12 hours', () => {
      expect(parseStepDurations('Refrigerate for 24 hours.')).toEqual([]);
    });

    it('returns nothing for empty text', () => {
      expect(parseStepDurations('')).toEqual([]);
      expect(parseStepDurations('   ')).toEqual([]);
    });
  });

  describe('multiple durations in one step', () => {
    it('picks out each distinct duration', () => {
      expect(seconds('Sauté 5 minutes, then simmer 20 minutes.')).toEqual([300, 1200]);
    });

    it('de-duplicates a duration restated in the same step', () => {
      expect(seconds('Cook 20 minutes. After 20 minutes, remove from heat.')).toEqual([1200]);
    });

    it('caps at three so the row cannot fill with chips', () => {
      const step = 'Rest 1 minute, cook 5 minutes, rest 10 minutes, cook 15 minutes, rest 20 minutes.';
      expect(parseStepDurations(step)).toHaveLength(3);
    });
  });

  it('finds the duration alongside a temperature in the same step', () => {
    expect(seconds('Bake at 400 degrees for 25 minutes.')).toEqual([1500]);
  });
});
