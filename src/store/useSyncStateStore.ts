import { create } from 'zustand';

interface SyncState {
  firstPullCompleted: boolean;
  setFirstPullCompleted: (v: boolean) => void;
}

// In-memory only — not persisted. Resets every cold start so the gate always
// waits for at least one real pull before showing onboarding to a signed-in user.
export const useSyncStateStore = create<SyncState>((set) => ({
  firstPullCompleted: false,
  setFirstPullCompleted: (v) => set({ firstPullCompleted: v }),
}));

export function useFirstPullDone(): boolean {
  return useSyncStateStore((s) => s.firstPullCompleted);
}
