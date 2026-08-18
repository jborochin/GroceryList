import { CookTimer } from '../types';
import {
  createTimer,
  firedTimers,
  formatClock,
  hasFired,
  markFired,
  pauseTimer,
  remainingSeconds,
  resumeTimer,
} from '../utils/cookTimers';

const NOW = 1_700_000_000_000;

describe('createTimer', () => {
  it('starts running with an absolute end time', () => {
    const timer = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW });

    expect(timer).toMatchObject({
      id: 't1',
      label: 'Step 3',
      totalSeconds: 1200,
      state: 'running',
      endsAt: NOW + 1_200_000,
    });
    expect(timer.remainingSeconds).toBeUndefined();
  });

  it('carries the step it came from', () => {
    const timer = createTimer({
      id: 't1',
      label: 'Step 3',
      totalSeconds: 60,
      now: NOW,
      stepIndex: 2,
    });
    expect(timer.stepIndex).toBe(2);
  });
});

describe('remainingSeconds', () => {
  it('counts down from the absolute end time', () => {
    const timer = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW });
    expect(remainingSeconds(timer, NOW + 30_000)).toBe(1170);
  });

  // The whole reason endsAt is absolute: JS timers stop ticking in the background,
  // but wall-clock time doesn't.
  it('reflects time that passed while the app was backgrounded', () => {
    const timer = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW });
    expect(remainingSeconds(timer, NOW + 600_000)).toBe(600);
  });

  it('never goes below zero', () => {
    const timer = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 60, now: NOW });
    expect(remainingSeconds(timer, NOW + 90_000)).toBe(0);
  });

  it('holds steady while paused', () => {
    const paused = pauseTimer(
      createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW }),
      NOW + 200_000
    );
    expect(remainingSeconds(paused, NOW + 200_000)).toBe(1000);
    expect(remainingSeconds(paused, NOW + 900_000)).toBe(1000);
  });

  it('is zero once fired', () => {
    const fired: CookTimer = { id: 't1', label: 'Step 3', totalSeconds: 60, state: 'fired' };
    expect(remainingSeconds(fired, NOW)).toBe(0);
  });
});

describe('hasFired', () => {
  const timer = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 60, now: NOW });

  it('is false before the end time', () => {
    expect(hasFired(timer, NOW + 59_000)).toBe(false);
  });

  it('is true at and after the end time', () => {
    expect(hasFired(timer, NOW + 60_000)).toBe(true);
    expect(hasFired(timer, NOW + 61_000)).toBe(true);
  });

  it('is false for a paused timer no matter how long it sits', () => {
    expect(hasFired(pauseTimer(timer, NOW + 10_000), NOW + 10_000_000)).toBe(false);
  });

  it('is false for a timer already marked fired, so it only reports once', () => {
    expect(hasFired(markFired(timer), NOW + 61_000)).toBe(false);
  });
});

describe('pauseTimer', () => {
  it('snapshots the remaining time and drops the end time', () => {
    const paused = pauseTimer(
      createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW }),
      NOW + 200_000
    );
    expect(paused.state).toBe('paused');
    expect(paused.remainingSeconds).toBe(1000);
    expect(paused.endsAt).toBeUndefined();
  });

  it('clears the notification handle, since the alert is cancelled when pausing', () => {
    const running: CookTimer = {
      ...createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW }),
      notificationId: 'notif-1',
    };
    expect(pauseTimer(running, NOW).notificationId).toBeUndefined();
  });

  it('leaves a non-running timer alone', () => {
    const fired: CookTimer = { id: 't1', label: 'Step 3', totalSeconds: 60, state: 'fired' };
    expect(pauseTimer(fired, NOW)).toBe(fired);
  });
});

describe('resumeTimer', () => {
  it('re-anchors the end time to now plus what was left', () => {
    const paused = pauseTimer(
      createTimer({ id: 't1', label: 'Step 3', totalSeconds: 1200, now: NOW }),
      NOW + 200_000
    );
    const resumed = resumeTimer(paused, NOW + 5_000_000);

    expect(resumed.state).toBe('running');
    expect(resumed.endsAt).toBe(NOW + 5_000_000 + 1_000_000);
    expect(resumed.remainingSeconds).toBeUndefined();
  });

  it('leaves a running timer alone', () => {
    const running = createTimer({ id: 't1', label: 'Step 3', totalSeconds: 60, now: NOW });
    expect(resumeTimer(running, NOW + 10_000)).toBe(running);
  });
});

describe('firedTimers', () => {
  it('reports every running timer that has passed its end time', () => {
    const done = createTimer({ id: 'a', label: 'Step 1', totalSeconds: 10, now: NOW });
    const going = createTimer({ id: 'b', label: 'Step 2', totalSeconds: 600, now: NOW });
    const paused = pauseTimer(
      createTimer({ id: 'c', label: 'Step 3', totalSeconds: 10, now: NOW }),
      NOW
    );

    expect(firedTimers([done, going, paused], NOW + 20_000).map((t) => t.id)).toEqual(['a']);
  });

  it('reports nothing when they have all been acknowledged', () => {
    const done = markFired(createTimer({ id: 'a', label: 'Step 1', totalSeconds: 10, now: NOW }));
    expect(firedTimers([done], NOW + 20_000)).toEqual([]);
  });
});

describe('formatClock', () => {
  it('renders minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(600)).toBe('10:00');
  });

  it('adds an hours field only when there are hours', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('clamps negatives to zero rather than rendering a minus sign', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
