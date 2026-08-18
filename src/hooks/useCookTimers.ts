import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { CookTimer } from '../types';
import { useCookSessionStore } from '../store/useCookSessionStore';
import { firedTimers, remainingSeconds } from '../utils/cookTimers';
import { haptics } from '../utils/haptics';
import {
  cancelTimerNotification,
  scheduleTimerNotification,
} from '../lib/cookNotifications';

const NO_TIMERS: CookTimer[] = [];

export interface CookTimerControls {
  timers: CookTimer[];
  /** A single clock for the whole screen, so every countdown re-renders together. */
  now: number;
  start: (label: string, totalSeconds: number, stepIndex?: number) => void;
  pause: (timer: CookTimer) => void;
  resume: (timer: CookTimer) => void;
  dismiss: (timer: CookTimer) => void;
  /** Cancel every pending alert — called when the session ends. */
  cancelAll: () => void;
}

/**
 * Drives cook mode's timers: one ticking clock, the alert when one runs out,
 * and the notification scheduling that mirrors each timer's lifecycle.
 *
 * Notification side effects live here rather than in the store so the store
 * stays a plain persisted data structure, testable without a native module.
 * They are also strictly best-effort — every call returns `null` on web or a
 * denied permission, and the countdown below never depends on one arriving.
 */
export function useCookTimers(recipeId: string, recipeTitle: string): CookTimerControls {
  const timers = useCookSessionStore((s) => s.sessions[recipeId]?.timers ?? NO_TIMERS);
  const addTimer = useCookSessionStore((s) => s.addTimer);
  const pauseTimerAction = useCookSessionStore((s) => s.pauseTimer);
  const resumeTimerAction = useCookSessionStore((s) => s.resumeTimer);
  const removeTimer = useCookSessionStore((s) => s.removeTimer);
  const markTimerFired = useCookSessionStore((s) => s.markTimerFired);
  const setTimerNotification = useCookSessionStore((s) => s.setTimerNotification);

  const [now, setNow] = useState(() => Date.now());

  const hasRunning = timers.some((t) => t.state === 'running');

  // Tick only while something is counting. A screen full of paused or spent
  // timers shouldn't re-render once a second for nothing.
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  // Intervals are throttled or suspended in the background, so the clock can
  // come back stale. Re-read it on foreground; because endsAt is absolute, one
  // read is all it takes to catch up.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  // Buzz once per timer as it runs out. markTimerFired flips it out of
  // 'running', which is what stops firedTimers from reporting it again.
  useEffect(() => {
    const due = firedTimers(timers, now);
    if (due.length === 0) return;
    haptics.warn();
    for (const timer of due) markTimerFired(recipeId, timer.id);
  }, [timers, now, recipeId, markTimerFired]);

  const start = useCallback(
    (label: string, totalSeconds: number, stepIndex?: number) => {
      const startedAt = Date.now();
      const id = addTimer(recipeId, { label, totalSeconds, stepIndex, now: startedAt });
      if (!id) return;
      setNow(startedAt);
      void scheduleTimerNotification(label, recipeTitle, startedAt + totalSeconds * 1000).then(
        (notificationId) => {
          if (notificationId) setTimerNotification(recipeId, id, notificationId);
        }
      );
    },
    [addTimer, recipeId, recipeTitle, setTimerNotification]
  );

  const pause = useCallback(
    (timer: CookTimer) => {
      void cancelTimerNotification(timer.notificationId);
      pauseTimerAction(recipeId, timer.id, Date.now());
    },
    [pauseTimerAction, recipeId]
  );

  const resume = useCallback(
    (timer: CookTimer) => {
      const resumedAt = Date.now();
      const left = remainingSeconds(timer, resumedAt);
      resumeTimerAction(recipeId, timer.id, resumedAt);
      setNow(resumedAt);
      void scheduleTimerNotification(
        timer.label,
        recipeTitle,
        resumedAt + left * 1000
      ).then((notificationId) => {
        if (notificationId) setTimerNotification(recipeId, timer.id, notificationId);
      });
    },
    [recipeId, recipeTitle, resumeTimerAction, setTimerNotification]
  );

  const dismiss = useCallback(
    (timer: CookTimer) => {
      void cancelTimerNotification(timer.notificationId);
      removeTimer(recipeId, timer.id);
    },
    [recipeId, removeTimer]
  );

  const cancelAll = useCallback(() => {
    for (const timer of timers) void cancelTimerNotification(timer.notificationId);
  }, [timers]);

  return { timers, now, start, pause, resume, dismiss, cancelAll };
}
