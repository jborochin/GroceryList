import { buildMealDeck } from '../utils/mealDeck';
import { deterministicRecipeId } from '../utils/deterministicId';
import type { Disposition } from '../store/useMealDispositionStore';
import type { Meal, Recipe } from '../types';

function meal(partial: Partial<Meal> & Pick<Meal, 'id'>): Meal {
  return {
    title: partial.id,
    cuisine: 'american',
    slots: ['lunch', 'dinner'],
    dietaryTags: [],
    servings: 1,
    ingredients: [],
    nutritionPerServing: { calories: 500, proteinG: 30, carbsG: 50, fatG: 18 },
    ...partial,
  };
}

function recipe(partial: Partial<Recipe> & Pick<Recipe, 'id'>): Recipe {
  return {
    title: partial.id,
    servings: 1,
    ingredients: [],
    nutritionPerServing: { calories: 500, proteinG: 30, carbsG: 50, fatG: 18 },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const TARGETS = {
  dailyCalories: 2000,
  macroGrams: { proteinG: 150, carbsG: 200, fatG: 67 },
};

const NONE: Record<string, Disposition> = {};

describe('buildMealDeck', () => {
  it('merges catalog meals and user recipes into cards', () => {
    const deck = buildMealDeck(
      [meal({ id: 'cat-a' })],
      [recipe({ id: 'rec-a' })],
      NONE,
      TARGETS
    );
    const byId = new Map(deck.map((c) => [c.id, c]));
    expect(byId.get('cat-a')?.source).toBe('catalog');
    expect(byId.get('rec-a')?.source).toBe('recipe');
    // Recipe cards are eligible for every slot since recipes carry no slot meta.
    expect(byId.get('rec-a')?.slots).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('excludes rejected cards entirely', () => {
    const deck = buildMealDeck(
      [meal({ id: 'keep' }), meal({ id: 'gone' })],
      [],
      { gone: 'rejected' },
      TARGETS
    );
    expect(deck.map((c) => c.id)).toEqual(['keep']);
  });

  it('appends later cards after fresh ones', () => {
    const deck = buildMealDeck(
      [meal({ id: 'fresh' }), meal({ id: 'deferred' })],
      [],
      { deferred: 'later' },
      TARGETS
    );
    expect(deck.map((c) => c.id)).toEqual(['fresh', 'deferred']);
  });

  it('orders fresh cards best-fit first (closer to daily protein/macro target)', () => {
    // `hi` is much closer to the 2000 cal / 150g protein daily target, so it
    // should rank ahead of the tiny `lo` meal.
    const deck = buildMealDeck(
      [
        meal({ id: 'lo', nutritionPerServing: { calories: 120, proteinG: 5, carbsG: 15, fatG: 3 } }),
        meal({ id: 'hi', nutritionPerServing: { calories: 1600, proteinG: 130, carbsG: 170, fatG: 55 } }),
      ],
      [],
      NONE,
      TARGETS
    );
    expect(deck.map((c) => c.id)).toEqual(['hi', 'lo']);
  });

  it('drops recipe clones of catalog meals so a meal never appears twice', () => {
    const cat = meal({ id: 'greek-bowl' });
    const clone = recipe({ id: deterministicRecipeId('greek-bowl'), title: 'Greek Bowl' });
    const deck = buildMealDeck([cat], [clone], NONE, TARGETS);
    expect(deck).toHaveLength(1);
    expect(deck[0].id).toBe('greek-bowl');
    expect(deck[0].source).toBe('catalog');
  });

  it('sorts cards without nutrition last', () => {
    const deck = buildMealDeck(
      [meal({ id: 'has-macros' })],
      [recipe({ id: 'no-macros', nutritionPerServing: undefined })],
      NONE,
      TARGETS
    );
    expect(deck.map((c) => c.id)).toEqual(['has-macros', 'no-macros']);
  });
});
