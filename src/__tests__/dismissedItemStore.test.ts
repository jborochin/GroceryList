import { useDismissedItemStore } from '../store/useDismissedItemStore';

// AsyncStorage is mapped to its official jest mock (see package.json moduleNameMapper),
// so the persisted store runs against an in-memory backend here.

const store = () => useDismissedItemStore.getState();

beforeEach(() => {
  useDismissedItemStore.setState({ names: [] });
});

describe('dismissMany', () => {
  it('adds all names in a single update', () => {
    store().dismissMany(['milk', 'egg', 'flour']);
    expect(store().names).toEqual(['milk', 'egg', 'flour']);
  });

  it('skips names that are already dismissed', () => {
    store().dismiss('milk');
    store().dismissMany(['milk', 'egg']);
    expect(store().names).toEqual(['milk', 'egg']);
  });

  it('leaves state untouched (same reference) when every name is already dismissed', () => {
    store().dismissMany(['milk', 'egg']);
    const before = store().names;
    store().dismissMany(['egg', 'milk']);
    expect(store().names).toBe(before);
  });

  it('does nothing for an empty list', () => {
    const before = store().names;
    store().dismissMany([]);
    expect(store().names).toBe(before);
  });
});

describe('interaction with prune', () => {
  it('prune drops bulk-dismissed names that leave the computed list', () => {
    store().dismissMany(['milk', 'egg', 'flour']);
    store().prune(['egg']);
    expect(store().names).toEqual(['egg']);
  });
});
