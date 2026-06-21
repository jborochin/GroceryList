const invokeMock = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabaseConfigured: true,
  getSupabase: () => ({ functions: { invoke: invokeMock } }),
}));

import { computeMissingMacros, estimateNutrition } from '../utils/computeNutrition';

// Dispatch the single invoke mock by edge-function slug.
function mockBySlug(handlers: Record<string, (opts: any) => any>) {
  invokeMock.mockImplementation((slug: string, opts: any) =>
    Promise.resolve(handlers[slug] ? handlers[slug](opts) : { data: null, error: new Error('no handler') }),
  );
}

const FLOUR = { name: 'flour', per100g: { calories: 364, proteinG: 10, carbsG: 76, fatG: 1 } };

beforeEach(() => {
  invokeMock.mockReset();
});

describe('estimateNutrition', () => {
  it('estimates via USDA (per-recipe + per-serving) and queries normalized names', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: true, foods: [FLOUR] }, error: null }),
    });
    // 100 g flour → factor 1 → exactly per100g; servings 2 → halved per serving
    const est = await estimateNutrition(['100 g flour'], 2);
    expect(est).not.toBeNull();
    expect(est!.perRecipe.calories).toBe(364);
    expect(est!.perServing.calories).toBe(182);
    expect(invokeMock).toHaveBeenCalledWith('usda-nutrition', { body: { foods: ['flour'] } });
  });

  it('falls back to CalorieNinjas when USDA returns nothing usable', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: false }, error: null }),
      'compute-nutrition': () => ({
        data: {
          ok: true,
          perRecipe: { calories: 800, proteinG: 40, carbsG: 80, fatG: 20 },
          perServing: { calories: 200, proteinG: 10, carbsG: 20, fatG: 5 },
        },
        error: null,
      }),
    });
    const est = await estimateNutrition(['1 cup mystery'], 4);
    expect(est!.perServing.calories).toBe(200);
    expect(est!.perRecipe.calories).toBe(800);
    expect(invokeMock).toHaveBeenCalledWith('compute-nutrition', {
      body: { ingredients: ['1 cup mystery'], servings: 4 },
    });
  });

  it('falls back when USDA matches no foods', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: true, foods: [] }, error: null }),
      'compute-nutrition': () => ({
        data: {
          ok: true,
          perRecipe: { calories: 500, proteinG: 1, carbsG: 1, fatG: 1 },
          perServing: { calories: 500, proteinG: 1, carbsG: 1, fatG: 1 },
        },
        error: null,
      }),
    });
    const est = await estimateNutrition(['1 cup mystery'], 1);
    expect(est!.perServing.calories).toBe(500);
  });

  it('returns null when both engines fail', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: false }, error: null }),
      'compute-nutrition': () => ({ data: { ok: false }, error: null }),
    });
    expect(await estimateNutrition(['1 cup flour'], 4)).toBeNull();
  });

  it('returns null for an empty ingredient list without calling the network', async () => {
    expect(await estimateNutrition([], 4)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('computeMissingMacros', () => {
  it('returns null when no fields are missing', async () => {
    expect(await computeMissingMacros(['1 cup flour'], 4, [])).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns null when the ingredient list is empty', async () => {
    expect(await computeMissingMacros([], 4, ['proteinG'])).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns only the requested per-serving keys', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: true, foods: [FLOUR] }, error: null }),
    });
    const result = await computeMissingMacros(['100 g flour'], 1, ['proteinG', 'fatG']);
    expect(result).toEqual({ proteinG: 10, fatG: 1 });
  });

  it('returns null when the estimate is unavailable', async () => {
    mockBySlug({
      'usda-nutrition': () => ({ data: { ok: false }, error: null }),
      'compute-nutrition': () => ({ data: null, error: new Error('boom') }),
    });
    expect(await computeMissingMacros(['1 cup flour'], 4, ['proteinG'])).toBeNull();
  });
});
