import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { CookSession, CookTimer } from '../types';
import {
  createSession,
  reconcileSession,
  toggleIndex,
} from '../utils/cookSession';
import {
  createTimer,
  markFired,
  pauseTimer as pauseTimerPure,
  resumeTimer as resumeTimerPure,
} from '../utils/cookTimers';
import { zustandStorage, STORAGE_KEYS } from './storage';

// In-progress cooks, keyed by recipe id.
//
// Device-local and NEVER synced — deliberately. A cook session is transient
// working state ("I've added the onion, the rice has 8 minutes left"), not a
// record of anything; the food log is the record. Syncing it would mean a
// half-checked list arriving on a device that isn't in the kitchen.
//
// Keying by recipe id rather than tracking one "active" session means cooking
// two things at once just works, with no "discard your other session?" prompt.
//
// Every non-trivial operation delegates to the pure helpers in
// utils/cookSession.ts and utils/cookTimers.ts; this file is persistence and
// nothing else.

/** Sessions untouched for this long are abandoned, not paused. */
const STALE_MS = 24 * 60 * 60 * 1000;

export interface EnsureSessionInput {
  recipeId: string;
  title: string;
  servings: number;
  ingredientCount: number;
  stepCount: number;
}

interface CookSessionState {
  sessions: Record<string, CookSession>;
  /** Open a session for this recipe, or bring an existing one back in line with the recipe. */
  ensure: (input: EnsureSessionInput) => void;
  toggleIngredient: (recipeId: string, index: number) => void;
  toggleStep: (recipeId: string, index: number) => void;
  setServings: (recipeId: string, servings: number) => void;
  /** Returns the new timer's id so the caller can schedule a notification for it. */
  addTimer: (
    recipeId: string,
    input: { label: string; totalSeconds: number; stepIndex?: number; now: number }
  ) => string | null;
  pauseTimer: (recipeId: string, timerId: string, now: number) => void;
  resumeTimer: (recipeId: string, timerId: string, now: number) => void;
  markTimerFired: (recipeId: string, timerId: string) => void;
  setTimerNotification: (recipeId: string, timerId: string, notificationId?: string) => void;
  removeTimer: (recipeId: string, timerId: string) => void;
  /** Close the session — done cooking, or abandoned. */
  end: (recipeId: string) => void;
  pruneStale: (now: number) => void;
}

export const useCookSessionStore = create<CookSessionState>()(
  persist(
    (set, get) => {
      // Every mutation stamps updatedAt, which is what pruneStale reads.
      const patch = (
        recipeId: string,
        fn: (session: CookSession) => CookSession
      ) => {
        set((s) => {
          const session = s.sessions[recipeId];
          if (!session) return s;
          const next = fn(session);
          if (next === session) return s;
          return {
            sessions: { ...s.sessions, [recipeId]: { ...next, updatedAt: Date.now() } },
          };
        });
      };

      const patchTimer = (
        recipeId: string,
        timerId: string,
        fn: (timer: CookTimer) => CookTimer
      ) => {
        patch(recipeId, (session) => {
          let changed = false;
          const timers = session.timers.map((t) => {
            if (t.id !== timerId) return t;
            const next = fn(t);
            if (next !== t) changed = true;
            return next;
          });
          return changed ? { ...session, timers } : session;
        });
      };

      return {
        sessions: {},

        ensure: ({ recipeId, title, servings, ingredientCount, stepCount }) => {
          set((s) => {
            const existing = s.sessions[recipeId];
            if (existing) {
              const reconciled = reconcileSession(existing, ingredientCount, stepCount);
              // Title can drift if the recipe was renamed; servings belong to
              // the session, so a resume keeps what the cook chose.
              const next =
                reconciled === existing && existing.title === title
                  ? existing
                  : { ...reconciled, title };
              return next === existing ? s : { sessions: { ...s.sessions, [recipeId]: next } };
            }
            return {
              sessions: {
                ...s.sessions,
                [recipeId]: createSession({
                  recipeId,
                  title,
                  servings,
                  ingredientCount,
                  stepCount,
                  now: Date.now(),
                }),
              },
            };
          });
        },

        toggleIngredient: (recipeId, index) => {
          patch(recipeId, (session) => ({
            ...session,
            checkedIngredients: toggleIndex(session.checkedIngredients, index),
          }));
        },

        toggleStep: (recipeId, index) => {
          patch(recipeId, (session) => ({
            ...session,
            checkedSteps: toggleIndex(session.checkedSteps, index),
          }));
        },

        setServings: (recipeId, servings) => {
          patch(recipeId, (session) =>
            session.servings === servings ? session : { ...session, servings }
          );
        },

        addTimer: (recipeId, { label, totalSeconds, stepIndex, now }) => {
          if (!get().sessions[recipeId]) return null;
          const id = uuid();
          patch(recipeId, (session) => ({
            ...session,
            timers: [
              ...session.timers,
              createTimer({ id, label, totalSeconds, stepIndex, now }),
            ],
          }));
          return id;
        },

        pauseTimer: (recipeId, timerId, now) => {
          patchTimer(recipeId, timerId, (t) => pauseTimerPure(t, now));
        },

        resumeTimer: (recipeId, timerId, now) => {
          patchTimer(recipeId, timerId, (t) => resumeTimerPure(t, now));
        },

        markTimerFired: (recipeId, timerId) => {
          patchTimer(recipeId, timerId, markFired);
        },

        setTimerNotification: (recipeId, timerId, notificationId) => {
          patchTimer(recipeId, timerId, (t) =>
            t.notificationId === notificationId ? t : { ...t, notificationId }
          );
        },

        removeTimer: (recipeId, timerId) => {
          patch(recipeId, (session) => {
            const timers = session.timers.filter((t) => t.id !== timerId);
            return timers.length === session.timers.length ? session : { ...session, timers };
          });
        },

        end: (recipeId) => {
          set((s) => {
            if (!s.sessions[recipeId]) return s;
            const { [recipeId]: _closed, ...rest } = s.sessions;
            return { sessions: rest };
          });
        },

        pruneStale: (now) => {
          set((s) => {
            const kept = Object.entries(s.sessions).filter(
              ([, session]) => now - session.updatedAt < STALE_MS
            );
            // Bail when nothing changed to avoid a needless re-render.
            if (kept.length === Object.keys(s.sessions).length) return s;
            return { sessions: Object.fromEntries(kept) };
          });
        },
      };
    },
    {
      name: STORAGE_KEYS.cookSessions,
      storage: zustandStorage,
    }
  )
);
