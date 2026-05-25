const invokeMock = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabaseConfigured: true,
  getSupabase: () => ({ functions: { invoke: invokeMock } }),
}));

import { computeMissingMacros } from '../utils/computeNutrition';

describe('computeMissingMacros', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('returns null when no fields are missing', async () => {
    const result = await computeMissingMacros(['1 cup flour'], 4, []);
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns null when ingredient list is empty', async () => {
    const result = await computeMissingMacros([], 4, ['proteinG']);
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns null when ingredients are all whitespace', async () => {
    const result = await computeMissingMacros(['  ', ''], 4, ['proteinG']);
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns only the requested keys from the edge function response', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        perServing: { calories: 200, proteinG: 22, carbsG: 8, fatG: 10 },
      },
      error: null,
    });
    const result = await computeMissingMacros(['1 cup flour'], 4, ['proteinG', 'fatG']);
    expect(result).toEqual({ proteinG: 22, fatG: 10 });
    expect(invokeMock).toHaveBeenCalledWith('compute-nutrition', {
      body: { ingredients: ['1 cup flour'], servings: 4 },
    });
  });

  it('returns null when the edge function reports ok:false', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: false, kind: 'not-configured', message: 'no creds' },
      error: null,
    });
    const result = await computeMissingMacros(['1 cup flour'], 4, ['proteinG']);
    expect(result).toBeNull();
  });

  it('returns null when invoke returns an error', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('boom') });
    const result = await computeMissingMacros(['1 cup flour'], 4, ['proteinG']);
    expect(result).toBeNull();
  });

  it('returns null when invoke throws', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const result = await computeMissingMacros(['1 cup flour'], 4, ['proteinG']);
    expect(result).toBeNull();
  });

  it('clamps servings to at least 1', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, perServing: { calories: 100, proteinG: 5, carbsG: 10, fatG: 2 } },
      error: null,
    });
    await computeMissingMacros(['1 cup flour'], 0, ['proteinG']);
    expect(invokeMock).toHaveBeenCalledWith('compute-nutrition', {
      body: { ingredients: ['1 cup flour'], servings: 1 },
    });
  });

  it('skips non-finite values returned by the edge function', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, perServing: { calories: 100, proteinG: NaN, carbsG: 10, fatG: 2 } },
      error: null,
    });
    const result = await computeMissingMacros(['1 cup flour'], 4, ['proteinG', 'fatG']);
    expect(result).toEqual({ fatG: 2 });
  });
});
