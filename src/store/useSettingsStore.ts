import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CookingFrequency, TdeeInputs, UserSettings } from '../types';
import { zustandStorage, STORAGE_KEYS } from './storage';

type OnboardingPayload = {
  onboardingCompleted: true;
  tdeeInputs?: TdeeInputs | null;
  dailyCalorieTarget?: number;
  macroSplit?: UserSettings['macroSplit'];
  macroGrams?: UserSettings['macroGrams'];
  cuisinePreferences?: string[];
  dietaryRestrictions?: string[];
  cookingFrequency?: CookingFrequency;
  cookingEasePreference?: number;
};

interface SettingsState {
  settings: UserSettings;
  setCalorieTarget: (target: number) => void;
  setMacroSplit: (proteinPct: number, carbsPct: number, fatPct: number) => void;
  setMacroGrams: (proteinG: number, carbsG: number, fatG: number) => void;
  setReduceVisualEffects: (value: boolean) => void;
  setCuisinePreferences: (keys: string[]) => void;
  setDietaryRestrictions: (keys: string[]) => void;
  setCookingFrequency: (freq: CookingFrequency) => void;
  setCookingEasePreference: (value: number) => void;
  setTdeeInputs: (inputs: TdeeInputs | null) => void;
  setOnboardingCompleted: (value: boolean) => void;
  applyOnboarding: (payload: OnboardingPayload) => void;
  resetSettings: () => void;
  hydrateFromServer: (settings: UserSettings) => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  dailyCalorieTarget: 2000,
  macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  macroGrams: { proteinG: 150, carbsG: 200, fatG: 67 },
  reduceVisualEffects: false,
  onboardingCompleted: false,
  tdeeInputs: null,
  cuisinePreferences: [],
  dietaryRestrictions: [],
  cookingFrequency: 'few_days',
  cookingEasePreference: 0.5,
};

const clampCalorie = (v: number) => Math.max(1000, Math.min(6000, Math.round(v)));
const clampGram = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const dedupedStrings = (xs: unknown): string[] => {
  if (!Array.isArray(xs)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    if (typeof x !== 'string') continue;
    const trimmed = x.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setCalorieTarget: (target) => {
        set((s) => ({ settings: { ...s.settings, dailyCalorieTarget: clampCalorie(target) } }));
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
      setCuisinePreferences: (keys) =>
        set((s) => ({ settings: { ...s.settings, cuisinePreferences: dedupedStrings(keys) } })),
      setDietaryRestrictions: (keys) =>
        set((s) => ({ settings: { ...s.settings, dietaryRestrictions: dedupedStrings(keys) } })),
      setCookingFrequency: (freq) =>
        set((s) => ({ settings: { ...s.settings, cookingFrequency: freq } })),
      setCookingEasePreference: (value) =>
        set((s) => ({ settings: { ...s.settings, cookingEasePreference: clamp01(value) } })),
      setTdeeInputs: (inputs) =>
        set((s) => ({ settings: { ...s.settings, tdeeInputs: inputs } })),
      setOnboardingCompleted: (value) =>
        set((s) => ({ settings: { ...s.settings, onboardingCompleted: value } })),
      applyOnboarding: (payload) => {
        // Single atomic mutation so the sync subscriber pushes one upsert
        // covering tdee_inputs + derived calorie/macro targets + preferences
        // + the completion flag together. Avoids racy half-state on the server.
        set((s) => {
          const next: UserSettings = { ...s.settings };
          next.onboardingCompleted = true;
          if (payload.tdeeInputs !== undefined) next.tdeeInputs = payload.tdeeInputs;
          if (payload.dailyCalorieTarget !== undefined) {
            next.dailyCalorieTarget = clampCalorie(payload.dailyCalorieTarget);
          }
          if (payload.macroSplit) {
            const { proteinPct, carbsPct, fatPct } = payload.macroSplit;
            const total = proteinPct + carbsPct + fatPct;
            if (total > 0) {
              const norm = (v: number) => Math.round((v / total) * 100);
              next.macroSplit = {
                proteinPct: norm(proteinPct),
                carbsPct: norm(carbsPct),
                fatPct: norm(fatPct),
              };
            }
          }
          if (payload.macroGrams) {
            next.macroGrams = {
              proteinG: clampGram(payload.macroGrams.proteinG),
              carbsG: clampGram(payload.macroGrams.carbsG),
              fatG: clampGram(payload.macroGrams.fatG),
            };
          }
          if (payload.cuisinePreferences !== undefined) {
            next.cuisinePreferences = dedupedStrings(payload.cuisinePreferences);
          }
          if (payload.dietaryRestrictions !== undefined) {
            next.dietaryRestrictions = dedupedStrings(payload.dietaryRestrictions);
          }
          if (payload.cookingFrequency !== undefined) {
            next.cookingFrequency = payload.cookingFrequency;
          }
          if (payload.cookingEasePreference !== undefined) {
            next.cookingEasePreference = clamp01(payload.cookingEasePreference);
          }
          return { settings: next };
        });
      },
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      hydrateFromServer: (settings) => set({ settings }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: zustandStorage,
      // Backfill any field missing from an older persisted blob so we don't blow
      // up on `settings.cuisinePreferences.map(...)` when a previous version
      // wrote a slimmer object.
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined;
        const ps = p?.settings as Partial<UserSettings> | undefined;
        return {
          ...current,
          ...p,
          settings: {
            ...current.settings,
            ...(ps ?? {}),
            macroSplit: { ...current.settings.macroSplit, ...(ps?.macroSplit ?? {}) },
            macroGrams: { ...current.settings.macroGrams, ...(ps?.macroGrams ?? {}) },
            reduceVisualEffects: ps?.reduceVisualEffects ?? false,
            onboardingCompleted: ps?.onboardingCompleted ?? false,
            tdeeInputs: ps?.tdeeInputs ?? null,
            cuisinePreferences: Array.isArray(ps?.cuisinePreferences) ? ps!.cuisinePreferences : [],
            dietaryRestrictions: Array.isArray(ps?.dietaryRestrictions) ? ps!.dietaryRestrictions : [],
            cookingFrequency: ps?.cookingFrequency ?? 'few_days',
            cookingEasePreference:
              typeof ps?.cookingEasePreference === 'number' ? ps!.cookingEasePreference : 0.5,
          },
        };
      },
    }
  )
);
