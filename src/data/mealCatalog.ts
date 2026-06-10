import raw from './mealCatalog.json';
import { Meal } from '../types';

// Bundled curated meal catalog — the offline-first source of truth for the
// auto meal-prep planner. The Supabase `meals` table mirrors this for
// server-side updates; see src/lib/mealCatalogSync.ts for the optional refresh.
export const MEAL_CATALOG: Meal[] = raw as Meal[];
