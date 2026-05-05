import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserSettings } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface SettingsState {
  settings: UserSettings;
  setCalorieTarget: (target: number) => void;
  setMacroSplit: (proteinPct: number, carbsPct: number, fatPct: number) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  dailyCalorieTarget: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
};

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
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: zustandStorage,
    }
  )
);
