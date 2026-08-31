import { Ingredient } from '../types';
import { hasSections, toSections } from '../utils/ingredientSections';

const ing = (name: string, section?: string): Ingredient => ({
  name,
  quantity: 1,
  unit: 'each',
  ...(section ? { section } : {}),
});

describe('toSections', () => {
  it('returns one untitled run for a list with no sections', () => {
    // Callers render the result unconditionally, so an unsectioned recipe must
    // still come back as a walkable structure rather than an empty one.
    const list = [ing('flour'), ing('sugar')];
    expect(toSections(list)).toEqual([
      { title: undefined, items: [{ ingredient: list[0], index: 0 }, { ingredient: list[1], index: 1 }] },
    ]);
  });

  it('returns an empty array for an empty list', () => {
    expect(toSections([])).toEqual([]);
  });

  it('groups consecutive ingredients sharing a section', () => {
    const list = [
      ing('chicken thighs', 'Marinade'),
      ing('garlic powder', 'Marinade'),
      ing('butter', 'Sauce'),
    ];
    const sections = toSections(list);
    expect(sections.map((s) => s.title)).toEqual(['Marinade', 'Sauce']);
    expect(sections[0].items.map((i) => i.ingredient.name)).toEqual([
      'chicken thighs',
      'garlic powder',
    ]);
  });

  it('keeps a leading unsectioned run separate from the first titled one', () => {
    const list = [ing('olive oil'), ing('chicken thighs', 'Marinade')];
    expect(toSections(list).map((s) => s.title)).toEqual([undefined, 'Marinade']);
  });

  it('reports flat indices, not positions within a run', () => {
    // Cook mode stores checked ingredients as indices into the recipe's own
    // array. If a run reported 0-based positions, checking the first item of the
    // second section would tick the first item of the first one.
    const list = [ing('a', 'One'), ing('b', 'Two'), ing('c', 'Two')];
    expect(toSections(list).map((s) => s.items.map((i) => i.index))).toEqual([[0], [1, 2]]);
  });

  it('does not reorder a title that reappears later', () => {
    // Document order is the recipe's own order. Merging the two "Sauce" runs
    // would move an ingredient away from the step that uses it.
    const list = [ing('a', 'Sauce'), ing('b', 'Rice'), ing('c', 'Sauce')];
    const sections = toSections(list);
    expect(sections.map((s) => s.title)).toEqual(['Sauce', 'Rice', 'Sauce']);
    expect(sections.flatMap((s) => s.items).map((i) => i.index)).toEqual([0, 1, 2]);
  });
});

describe('hasSections', () => {
  it('is false when nothing carries a title', () => {
    expect(hasSections([ing('flour'), ing('sugar')])).toBe(false);
  });

  it('is true when any ingredient carries one', () => {
    expect(hasSections([ing('flour'), ing('butter', 'Sauce')])).toBe(true);
  });
});
