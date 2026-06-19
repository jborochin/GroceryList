/**
 * Pure merge rule for applying a server pull onto local state without
 * clobbering local intent. Deliberately timestamp-free: the server's
 * touch_updated_at trigger overwrites updated_at on every update, so
 * device-vs-server timestamp comparison is unsound under clock skew. Instead,
 * local intent is detected deterministically:
 *
 *  - editedKeys: the item changed locally while the pull was in flight
 *    (detected by per-key reference inequality against a pre-fetch snapshot —
 *    covers adds, edits, and deletes).
 *  - pendingUpsertKeys / pendingDeleteKeys: a failed push for the key is
 *    queued in the outbox and hasn't reached the server yet.
 *
 * Precedence per key: local edit > queued delete > server tombstone > server
 * live row > local-only (kept and reported in toPush — a row the server has
 * never seen, e.g. created before sign-in or during a failed migrate).
 *
 * Known accepted limitation: an item deleted locally while signed OUT leaves
 * no outbox entry, so the server's live row resurrects it once on the next
 * sign-in. Fixing that needs persistent local tombstones; not worth it yet.
 */

export interface MergeInput<T> {
  local: Map<string, T>;
  serverLive: Map<string, T>;
  serverDeadKeys: Set<string>;
  editedKeys: Set<string>;
  pendingUpsertKeys: Set<string>;
  pendingDeleteKeys: Set<string>;
}

export interface MergeResult<T> {
  next: Array<[string, T]>;
  toPush: Array<[string, T]>;
}

export function mergeKeyed<T>(input: MergeInput<T>): MergeResult<T> {
  const { local, serverLive, serverDeadKeys, editedKeys, pendingUpsertKeys, pendingDeleteKeys } =
    input;
  const next: Array<[string, T]> = [];
  const toPush: Array<[string, T]> = [];

  const keys = new Set<string>([...local.keys(), ...serverLive.keys()]);
  for (const key of keys) {
    const l = local.get(key);
    // Local change during the pull wins outright — including a local delete
    // (l undefined), which must not be resurrected by the stale fetch.
    if (editedKeys.has(key)) {
      if (l !== undefined) next.push([key, l]);
      continue;
    }
    if (l !== undefined && pendingUpsertKeys.has(key)) {
      next.push([key, l]);
      continue;
    }
    if (pendingDeleteKeys.has(key)) continue;
    if (serverDeadKeys.has(key)) continue;
    const s = serverLive.get(key);
    if (s !== undefined) {
      next.push([key, s]);
      continue;
    }
    if (l !== undefined) {
      next.push([key, l]);
      toPush.push([key, l]);
    }
  }

  return { next, toPush };
}

/** Keys whose value reference changed between snapshot and current — adds, edits, and removals. */
export function diffKeys<T>(snapshot: Map<string, T>, current: Map<string, T>): Set<string> {
  const edited = new Set<string>();
  for (const [k, v] of current) {
    if (snapshot.get(k) !== v) edited.add(k);
  }
  for (const k of snapshot.keys()) {
    if (!current.has(k)) edited.add(k);
  }
  return edited;
}
