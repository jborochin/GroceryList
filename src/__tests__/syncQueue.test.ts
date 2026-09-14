import { STORAGE_KEYS } from '../store/storage';

// The module caches the parsed outbox in memory, so each case needs a fresh
// module instance. jest.resetModules() also re-instantiates the AsyncStorage
// mock, so the blob must be written through the instance the fresh queue sees.
async function freshQueue(blob: string) {
  jest.resetModules();
  const storage = (await import('@react-native-async-storage/async-storage')).default;
  await storage.clear();
  await storage.setItem(STORAGE_KEYS.outbox, blob);
  const queue = await import('../lib/syncQueue');
  return { queue, storage };
}

describe('syncQueue with a corrupt persisted outbox', () => {
  it.each([['{'], ['null'], ['{}'], ['"str"'], ['42']])(
    'treats %s as an empty queue and keeps working',
    async (blob) => {
      const { queue } = await freshQueue(blob);
      await expect(queue.peekAll()).resolves.toEqual([]);
      await queue.enqueue({ table: 'recipes', op: 'upsert', payload: { id: 'r1', user_id: 'u' } });
      const all = await queue.peekAll();
      expect(all).toHaveLength(1);
      expect(all[0].payload).toEqual({ id: 'r1', user_id: 'u' });
    }
  );

  it('drops non-entry junk inside an otherwise valid array', async () => {
    const { queue } = await freshQueue(
      JSON.stringify([
        null,
        5,
        { id: 'ok', table: 'recipes', op: 'delete', payload: { id: 'r1' }, enqueuedAt: 1 },
        { id: 'no-op', table: 'recipes', payload: {} },
      ])
    );
    const all = await queue.peekAll();
    expect(all.map((e) => e.id)).toEqual(['ok']);
  });

  it('round-trips a healthy queue unchanged', async () => {
    const entry = { id: 'a', table: 'pantry_items', op: 'upsert', payload: { id: 'p' }, enqueuedAt: 2 };
    const { queue } = await freshQueue(JSON.stringify([entry]));
    await expect(queue.peekAll()).resolves.toEqual([entry]);
  });
});
