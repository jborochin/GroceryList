import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../store/storage';

export type OutboxOp = 'upsert' | 'delete';
export type OutboxTable =
  | 'recipes'
  | 'meal_plan_entries'
  | 'pantry_items'
  | 'price_overrides'
  | 'user_settings'
  | 'food_log_entries'
  | 'custom_foods';

export interface OutboxEntry {
  id: string;            // outbox row id (uuid-ish)
  table: OutboxTable;
  op: OutboxOp;
  payload: Record<string, unknown>;
  enqueuedAt: number;
}

let inMemory: OutboxEntry[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

function isEntry(x: unknown): x is OutboxEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.table === 'string' &&
    (e.op === 'upsert' || e.op === 'delete') &&
    !!e.payload &&
    typeof e.payload === 'object'
  );
}

async function read(): Promise<OutboxEntry[]> {
  if (inMemory) return inMemory;
  // A corrupt outbox must not take every push down with it. Anything that isn't a
  // list of well-formed entries is treated as empty; the next persist overwrites it.
  let parsed: unknown = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.outbox);
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  inMemory = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  return inMemory;
}

function persist(entries: OutboxEntry[]): Promise<void> {
  inMemory = entries;
  // Serialize writes so we don't race AsyncStorage.
  writeChain = writeChain.then(() => AsyncStorage.setItem(STORAGE_KEYS.outbox, JSON.stringify(entries)));
  return writeChain;
}

// The column that uniquely identifies a row within its user's data, used to
// collapse repeated failed pushes for the same row into one outbox entry and
// to let the pull merge veto server rows that have unsynced local changes.
export function naturalKey(table: OutboxTable, payload: Record<string, unknown>): unknown {
  switch (table) {
    case 'recipes':
    case 'pantry_items':
    case 'food_log_entries':
    case 'custom_foods':
      return payload.id;
    case 'meal_plan_entries':
      return payload.recipe_id;
    case 'price_overrides':
      return payload.normalized_name;
    case 'user_settings':
      return payload.user_id;
  }
}

export async function enqueue(entry: Omit<OutboxEntry, 'id' | 'enqueuedAt'>): Promise<void> {
  const list = await read();
  const next: OutboxEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enqueuedAt: Date.now(),
  };
  // Dedupe by (table, op, row): keep only the latest payload so repeated edits
  // to one row while offline don't grow the queue unboundedly.
  const key = naturalKey(entry.table, entry.payload);
  const deduped =
    key == null
      ? list
      : list.filter(
          (e) =>
            !(e.table === entry.table && e.op === entry.op && naturalKey(e.table, e.payload) === key)
        );
  await persist([...deduped, next]);
}

export async function peekAll(): Promise<OutboxEntry[]> {
  return [...(await read())];
}

export async function removeMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const list = await read();
  await persist(list.filter((e) => !set.has(e.id)));
}

export async function clearOutbox(): Promise<void> {
  await persist([]);
}
