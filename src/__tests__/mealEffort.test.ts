import { mealEffortScore } from '../utils/mealEffort';
import type { Meal } from '../types';

function meal(partial: Partial<Meal> & Pick<Meal, 'id'>): Meal {
  return {
    title: partial.id,
    cuisine: 'american',
    slots: ['lunch'],
    dietaryTags: [],
    servings: 1,
    ingredients: [],
    nutritionPerServing: { calories: 500, proteinG: 30, carbsG: 50, fatG: 18 },
    ...partial,
  };
}

function ingredients(n: number): Meal['ingredients'] {
  return Array.from({ length: n }, (_, i) => ({ name: `ing-${i}`, quantity: 1, unit: 'each' }));
}

function steps(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `step ${i}`);
}

describe('mealEffortScore', () => {
  it('scores a quick, simple meal near the easy end', () => {
    // Overnight Oats: 5 min, 5 ingredients, 5 steps.
    const oats = meal({
      id: 'oats',
      prepTimeMinutes: 5,
      ingredients: ingredients(5),
      instructions: steps(5),
    });
    expect(mealEffortScore(oats)).toBeLessThan(0.4);
  });

  it('scores a longer, multi-step meal higher than a quick one', () => {
    const oats = meal({
      id: 'oats',
      prepTimeMinutes: 5,
      ingredients: ingredients(5),
      instructions: steps(5),
    });
    // Shakshuka-class: 25 min, 6 ingredients, 6 steps.
    const shakshuka = meal({
      id: 'shakshuka',
      prepTimeMinutes: 25,
      ingredients: ingredients(6),
      instructions: steps(6),
    });
    expect(mealEffortScore(shakshuka)).toBeGreaterThan(mealEffortScore(oats));
  });

  it('returns values within [0, 1] at the extremes', () => {
    const trivial = meal({
      id: 'trivial',
      prepTimeMinutes: 1,
      ingredients: ingredients(1),
      instructions: steps(1),
    });
    const elaborate = meal({
      id: 'elaborate',
      prepTimeMinutes: 90,
      ingredients: ingredients(20),
      instructions: steps(15),
    });
    expect(mealEffortScore(trivial)).toBe(0);
    expect(mealEffortScore(elaborate)).toBe(1);
  });

  it('falls back to the neutral midpoint when no signal is present', () => {
    const bare = meal({ id: 'bare', ingredients: [] });
    expect(mealEffortScore(bare)).toBe(0.5);
  });

  it('averages only the components that are present', () => {
    // No prep time, no instructions — score derives from ingredient count alone.
    const ingredientsOnly = meal({ id: 'ing-only', ingredients: ingredients(12) });
    expect(mealEffortScore(ingredientsOnly)).toBe(1);
  });
});
