import { CookSession } from '../types';
import {
  createSession,
  reconcileSession,
  sessionProgress,
  toggleIndex,
} from '../utils/cookSession';

const NOW = 1_700_000_000_000;

const session = (over: Partial<CookSession> = {}): CookSession => ({
  ...createSession({
    recipeId: 'r1',
    title: 'Chicken Curry',
    servings: 4,
    ingredientCount: 9,
    stepCount: 8,
    now: NOW,
  }),
  ...over,
});

describe('createSession', () => {
  it('starts with nothing checked and no timers', () => {
    expect(
      createSession({
        recipeId: 'r1',
        title: 'Chicken Curry',
        servings: 4,
        ingredientCount: 9,
        stepCount: 8,
        now: NOW,
      })
    ).toEqual({
      recipeId: 'r1',
      title: 'Chicken Curry',
      servings: 4,
      checkedIngredients: [],
      checkedSteps: [],
      ingredientCount: 9,
      stepCount: 8,
      timers: [],
      startedAt: NOW,
      updatedAt: NOW,
    });
  });
});

describe('toggleIndex', () => {
  it('adds an index that is not there', () => {
    expect(toggleIndex([0, 2], 1)).toEqual([0, 1, 2]);
  });

  it('removes an index that is', () => {
    expect(toggleIndex([0, 1, 2], 1)).toEqual([0, 2]);
  });

  it('keeps the list sorted so rendering order never depends on tap order', () => {
    expect(toggleIndex([5, 1], 3)).toEqual([1, 3, 5]);
  });
});

describe('reconcileSession', () => {
  it('leaves the session alone when the recipe has not changed shape', () => {
    const s = session({ checkedIngredients: [0, 1], checkedSteps: [0] });
    expect(reconcileSession(s, 9, 8)).toBe(s);
  });

  // Indices into an edited recipe point at the wrong rows. Dropping the checks
  // is honest; silently marking the wrong ingredient "used" is not.
  it('drops ingredient checks when the ingredient count changed', () => {
    const s = session({ checkedIngredients: [0, 1], checkedSteps: [0] });
    const next = reconcileSession(s, 7, 8);

    expect(next.checkedIngredients).toEqual([]);
    expect(next.ingredientCount).toBe(7);
    expect(next.checkedSteps).toEqual([0]);
  });

  it('drops step checks when the step count changed', () => {
    const s = session({ checkedIngredients: [0, 1], checkedSteps: [0] });
    const next = reconcileSession(s, 9, 5);

    expect(next.checkedSteps).toEqual([]);
    expect(next.stepCount).toBe(5);
    expect(next.checkedIngredients).toEqual([0, 1]);
  });

  it('keeps the timers running through a recipe edit', () => {
    const timers = [
      { id: 't1', label: 'Step 3', totalSeconds: 600, endsAt: NOW + 600_000, state: 'running' as const },
    ];
    expect(reconcileSession(session({ timers }), 3, 3).timers).toEqual(timers);
  });
});

describe('sessionProgress', () => {
  it('reports checked steps against the total', () => {
    expect(sessionProgress(session({ checkedSteps: [0, 1, 2] }))).toEqual({
      checked: 3,
      total: 8,
      ratio: 0.375,
    });
  });

  it('reports a zero ratio rather than dividing by zero for a recipe with no steps', () => {
    expect(sessionProgress(session({ stepCount: 0, checkedSteps: [] }))).toEqual({
      checked: 0,
      total: 0,
      ratio: 0,
    });
  });
});
