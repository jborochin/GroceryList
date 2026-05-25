import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserSettings } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface SettingsState {
  settings: UserSettings;
  setCalorieTarget: (target: number) => void;
  setMacroSplit: (proteinPct: number, carbsPct: number, fatPct: number) => void;
  setMacroGrams: (proteinG: number, carbsG: number, fatG: number) => void;
  setReduceVisualEffects: (value: boolean) => void;
  resetSettings: () => void;
  hydrateFromServer: (settings: UserSettings) => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  dailyCalorieTarget: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  macroGrams: { proteinG: 150, carbsG: 200, fatG: 67 },
  reduceVisualEffects: false,
};

const clampGram = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setCalorieTarget: (target) => {
        const safe = Math.max(1000, Math.min(6000, Math.round(target)));
        set((s) => ({ settings: { ...s.settings, dailyCalorieTarget: safe } }));
      },
      setMacroSplit: (proteinPct, carbsPct, fatPct) => {
        const total = proteinPct + carbsPct + fatPct;
        if (total === 0) return;
        const norm = (v: number) => Math.round((v / total) * 100);
        set((s) => ({
          settings: {
            ...s.settings,
            macroSplit: { proteinPct: norm(proteinPct), carbsPct: norm(carbsPct), fatPct: norm(fatPct) },
          },
        }));
      },
      setMacroGrams: (proteinG, carbsG, fatG) => {
        set((s) => ({
          settings: {
            ...s.settings,
            macroGrams: { proteinG: clampGram(proteinG), carbsG: clampGram(carbsG), fatG: clampGram(fatG) },
          },
        }));
      },
      setReduceVisualEffects: (value) =>
        set((s) => ({ settings: { ...s.settings, reduceVisualEffects: value } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      hydrateFromServer: (settings) => set({ settings }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: zustandStorage,
      // Hydrate older persisted blobs that predate `reduceVisualEffects` and `macroGrams`.
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined;
        const persistedSettings = p?.settings as Partial<UserSettings> | undefined;
        return {
          ...current,
          ...p,
          settings: {
            ...current.settings,
            ...(persistedSettings ?? {}),
            macroSplit: { ...current.settings.macroSplit, ...(persistedSettings?.macroSplit ?? {}) },
            macroGrams: { ...current.settings.macroGrams, ...(persistedSettings?.macroGrams ?? {}) },
            reduceVisualEffects: persistedSettings?.reduceVisualEffects ?? false,
          },
        };
      },
    }
  )
);
