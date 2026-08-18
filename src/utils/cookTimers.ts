import { CookTimer } from '../types';

// Timer math for cook mode. Every function here is pure and takes `now`
// explicitly — nothing reads the clock for itself, so the whole module is
// testable and the screen can tick from a single `now` state.
//
// The invariant this file exists to protect: a RUNNING timer is described by an
// absolute `endsAt`, never by a stored countdown. JS intervals stop firing when
// the app is backgrounded, but wall-clock time keeps moving; deriving the
// remainder from Date.now() means a suspended app resumes with the right
// number instead of a frozen one. Pausing is the only thing that converts to a
// stored remainder, and resuming re-anchors it to a fresh `endsAt`.

export interface CreateTimerInput {
  id: string;
  label: string;
  totalSeconds: number;
  now: number;
  stepIndex?: number;
}

export function createTimer({
  id,
  label,
  totalSeconds,
  now,
  stepIndex,
}: CreateTimerInput): CookTimer {
  return {
    id,
    label,
    stepIndex,
    totalSeconds,
    endsAt: now + totalSeconds * 1000,
    state: 'running',
  };
}

/** What the clock should read. Paused holds; fired is spent. */
export function remainingSeconds(timer: CookTimer, now: number): number {
  if (timer.state === 'paused') return Math.max(0, timer.remainingSeconds ?? 0);
  if (timer.state === 'fired' || timer.endsAt === undefined) return 0;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

/**
 * True only for a running timer that has just passed its end time — i.e. one
 * that still owes the user an alert. Goes false again once markFired() has
 * acknowledged it, so the caller buzzes once rather than every tick.
 */
export function hasFired(timer: CookTimer, now: number): boolean {
  return timer.state === 'running' && timer.endsAt !== undefined && now >= timer.endsAt;
}

export function firedTimers(timers: CookTimer[], now: number): CookTimer[] {
  return timers.filter((t) => hasFired(t, now));
}

export function markFired(timer: CookTimer): CookTimer {
  if (timer.state === 'fired') return timer;
  return { ...timer, state: 'fired', endsAt: undefined, remainingSeconds: 0 };
}

/**
 * Freeze a running timer. The notification handle is dropped because the caller
 * cancels the scheduled alert when pausing — keeping a stale id would leave a
 * notification nobody can cancel.
 */
export function pauseTimer(timer: CookTimer, now: number): CookTimer {
  if (timer.state !== 'running') return timer;
  return {
    ...timer,
    state: 'paused',
    remainingSeconds: remainingSeconds(timer, now),
    endsAt: undefined,
    notificationId: undefined,
  };
}

/** Re-anchor a paused timer to `now`, so the pause itself costs no countdown. */
export function resumeTimer(timer: CookTimer, now: number): CookTimer {
  if (timer.state !== 'paused') return timer;
  const left = Math.max(0, timer.remainingSeconds ?? 0);
  return {
    ...timer,
    state: 'running',
    endsAt: now + left * 1000,
    remainingSeconds: undefined,
  };
}

/** Countdown display: '9:59', '1:02:03'. Hours appear only when there are hours. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${minutes}:${pad(secs)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
