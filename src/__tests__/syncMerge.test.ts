import { mergeKeyed, diffKeys, MergeInput } from '../utils/syncMerge';

interface Item {
  id: string;
  value: string;
}

const item = (id: string, value = 'v'): Item => ({ id, value });

function input(partial: Partial<MergeInput<Item>>): MergeInput<Item> {
  return {
    local: new Map(),
    serverLive: new Map(),
    serverDeadKeys: new Set(),
    editedKeys: new Set(),
    pendingUpsertKeys: new Set(),
    pendingDeleteKeys: new Set(),
    ...partial,
  };
}

const keys = (pairs: Array<[string, Item]>) => pairs.map(([k]) => k).sort();

describe('mergeKeyed', () => {
  it('server wins for untouched keys', () => {
    const localA = item('a', 'stale');
    const serverA = item('a', 'fresh');
    const r = mergeKeyed(
      input({ local: new Map([['a', localA]]), serverLive: new Map([['a', serverA]]) })
    );
    expect(r.next).toEqual([['a', serverA]]);
    expect(r.toPush).toEqual([]);
  });

  it('tombstone removes the local copy', () => {
    const r = mergeKeyed(
      input({ local: new Map([['a', item('a')]]), serverDeadKeys: new Set(['a']) })
    );
    expect(r.next).toEqual([]);
  });

  it('local edit during pull beats the stale server row', () => {
    const localA = item('a', 'edited');
    const r = mergeKeyed(
      input({
        local: new Map([['a', localA]]),
        serverLive: new Map([['a', item('a', 'stale')]]),
        editedKeys: new Set(['a']),
      })
    );
    expect(r.next).toEqual([['a', localA]]);
  });

  it('local delete during pull is not resurrected', () => {
    const r = mergeKeyed(
      input({
        local: new Map(),
        serverLive: new Map([['a', item('a')]]),
        editedKeys: new Set(['a']),
      })
    );
    expect(r.next).toEqual([]);
  });

  it('pending outbox upsert beats the server row', () => {
    const localA = item('a', 'queued');
    const r = mergeKeyed(
      input({
        local: new Map([['a', localA]]),
        serverLive: new Map([['a', item('a', 'stale')]]),
        pendingUpsertKeys: new Set(['a']),
      })
    );
    expect(r.next).toEqual([['a', localA]]);
  });

  it('pending outbox delete beats the server live row', () => {
    const r = mergeKeyed(
      input({
        local: new Map(),
        serverLive: new Map([['a', item('a')]]),
        pendingDeleteKeys: new Set(['a']),
      })
    );
    expect(r.next).toEqual([]);
  });

  it('local edit beats a tombstone (re-creation intent)', () => {
    const localA = item('a', 'recreated');
    const r = mergeKeyed(
      input({
        local: new Map([['a', localA]]),
        serverDeadKeys: new Set(['a']),
        editedKeys: new Set(['a']),
      })
    );
    expect(r.next).toEqual([['a', localA]]);
  });

  it('local-only rows are kept and reported for push', () => {
    const localA = item('a');
    const serverB = item('b');
    const r = mergeKeyed(
      input({ local: new Map([['a', localA]]), serverLive: new Map([['b', serverB]]) })
    );
    expect(keys(r.next)).toEqual(['a', 'b']);
    expect(r.toPush).toEqual([['a', localA]]);
  });

  it('tombstoned rows are never pushed back', () => {
    const r = mergeKeyed(
      input({ local: new Map([['a', item('a')]]), serverDeadKeys: new Set(['a']) })
    );
    expect(r.toPush).toEqual([]);
  });
});

describe('diffKeys', () => {
  it('detects replaced references, additions, and removals', () => {
    const a1 = item('a');
    const b1 = item('b');
    const snapshot = new Map([
      ['a', a1],
      ['b', b1],
    ]);
    const current = new Map([
      ['a', a1], // untouched — same reference
      ['b', item('b', 'edited')], // replaced reference
      ['c', item('c')], // added
      // 'd' would be a removal if it were in snapshot
    ]);
    snapshot.set('d', item('d'));
    const edited = diffKeys(snapshot, current);
    expect([...edited].sort()).toEqual(['b', 'c', 'd']);
  });
});
