import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS, zustandStorage } from './storage';

// How the user has triaged a meal in the cookbook swipe deck:
// - 'rejected' (swipe left / torn out): hidden from future decks until reset.
// - 'later' (swipe right / page flipped): not this week, but resurfaces in
//   future decks (sorted after fresh meals so it doesn't crowd the front).
// Swipe up ("this week") records no disposition — it only adds to the current
// selection, and clears any prior 'later' so a kept meal isn't double-handled.
export type Disposition = 'rejected' | 'later';

// Device-local (not synced), mirroring useMealScheduleStore. Keyed by the deck
// card id, which is a catalog meal slug OR a user recipe id — both globally
// unique, so a single flat map is unambiguous.
interface MealDispositionState {
  dispositions: Record<string, Disposition>;
  setDisposition: (id: string, disposition: Disposition) => void;
  clearDisposition: (id: string) => void;
  resetRejected: () => void;
  clearAll: () => void;
}

export const useMealDispositionStore = create<MealDispositionState>()(
  persist(
    (set) => ({
      dispositions: {},
      setDisposition: (id, disposition) =>
        set((s) => ({ dispositions: { ...s.dispositions, [id]: disposition } })),
      clearDisposition: (id) =>
        set((s) => {
          if (!(id in s.dispositions)) return s;
          const next = { ...s.dispositions };
          delete next[id];
          return { dispositions: next };
        }),
      // "Bring back passed meals" — drop every 'rejected' mark, keeping 'later'
      // so deferred picks still come back without un-hiding everything.
      resetRejected: () =>
        set((s) => {
          const next: Record<string, Disposition> = {};
          for (const [id, d] of Object.entries(s.dispositions)) {
            if (d !== 'rejected') next[id] = d;
          }
          return { dispositions: next };
        }),
      clearAll: () => set({ dispositions: {} }),
    }),
    {
      name: STORAGE_KEYS.mealDisposition,
      storage: zustandStorage,
    }
  )
);
