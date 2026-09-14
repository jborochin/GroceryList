jest.mock('../lib/supabase', () => ({
  supabaseConfigured: false,
  getSupabase: () => {
    throw new Error('supabase not configured in tests');
  },
}));

import { rowToMeal } from '../lib/mealCatalogSync';

describe('rowToMeal', () => {
  const row = {
    id: 'pad-thai',
    title: 'Pad Thai',
    cuisine: 'thai',
    slots: ['dinner'],
    dietary_tags: [],
    servings: 2,
    ingredients: [{ name: 'rice noodle', quantity: 200, unit: 'g' }],
    nutrition_per_serving: { calories: 600, proteinG: 25, carbsG: 80, fatG: 18 },
    image_url: 'https://cdn.example.com/pad-thai.jpg',
  };

  it('maps a well-formed row', () => {
    const m = rowToMeal(row);
    expect(m.servings).toBe(2);
    expect(m.nutritionPerServing.calories).toBe(600);
    expect(m.imageUrl).toBe('https://cdn.example.com/pad-thai.jpg');
  });

  it('never yields NaN servings or a nutrition object the planner can crash on', () => {
    const m = rowToMeal({ ...row, servings: null, nutrition_per_serving: null });
    expect(m.servings).toBe(1);
    expect(m.nutritionPerServing).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    const m2 = rowToMeal({ ...row, servings: 'many', nutrition_per_serving: { calories: '1e999' } });
    expect(m2.servings).toBe(1);
    expect(m2.nutritionPerServing.calories).toBe(0);
  });

  it('drops a non-http image url and a non-array ingredient list', () => {
    const m = rowToMeal({ ...row, image_url: 'file:///etc/passwd', ingredients: { a: 1 } });
    expect(m.imageUrl).toBeUndefined();
    expect(m.ingredients).toEqual([]);
  });
});
