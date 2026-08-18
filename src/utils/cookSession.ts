import { CookSession } from '../types';

// Pure shape operations on a cook session. The store (useCookSessionStore) is a
// thin persistence wrapper over these, so all the reasoning lives here where it
// can be tested without AsyncStorage.

export interface CreateSessionInput {
  recipeId: string;
  title: string;
  servings: number;
  ingredientCount: number;
  stepCount: number;
  now: number;
}

export function createSession({
  recipeId,
  title,
  servings,
  ingredientCount,
  stepCount,
  now,
}: CreateSessionInput): CookSession {
  return {
    recipeId,
    title,
    servings,
    checkedIngredients: [],
    checkedSteps: [],
    ingredientCount,
    stepCount,
    timers: [],
    startedAt: now,
    updatedAt: now,
  };
}

/** Add or remove an index, keeping the list sorted. */
export function toggleIndex(list: number[], index: number): number[] {
  return list.includes(index)
    ? list.filter((i) => i !== index)
    : [...list, index].sort((a, b) => a - b);
}

/**
 * Bring a stored session back in line with the recipe it belongs to.
 *
 * Checks are indices, so a recipe edited mid-cook (a step inserted, an
 * ingredient removed) would leave them pointing at the wrong rows. Dropping the
 * affected set is the honest answer — showing an ingredient as "used" when it
 * isn't could ruin the dish. Ingredients and steps are reconciled
 * independently, so editing one doesn't clear the other, and the timers always
 * survive: a pot on the stove doesn't care that the text changed.
 */
export function reconcileSession(
  session: CookSession,
  ingredientCount: number,
  stepCount: number
): CookSession {
  const ingredientsStale = session.ingredientCount !== ingredientCount;
  const stepsStale = session.stepCount !== stepCount;
  if (!ingredientsStale && !stepsStale) return session;

  return {
    ...session,
    ingredientCount,
    stepCount,
    checkedIngredients: ingredientsStale ? [] : session.checkedIngredients,
    checkedSteps: stepsStale ? [] : session.checkedSteps,
  };
}

export interface SessionProgress {
  checked: number;
  total: number;
  /** 0–1, for the progress bar. Zero for a recipe with no steps rather than NaN. */
  ratio: number;
}

export function sessionProgress(session: CookSession): SessionProgress {
  const checked = session.checkedSteps.length;
  const total = session.stepCount;
  return { checked, total, ratio: total > 0 ? checked / total : 0 };
}
