/**
 * Load the repo-root `.env` into process.env for the developer scripts.
 *
 * Expo/Metro reads `.env` automatically for the app, but plain `tsx script.ts`
 * does not — so without this, credentials sitting in `.env` are invisible to
 * scripts/refreshKrogerPrices.ts and friends.
 *
 * Real environment variables always win, so CI (which sets secrets directly and
 * has no `.env` file) is unaffected. A missing `.env` is a silent no-op, which
 * is why this is preferred over node's `--env-file` flag — that throws when the
 * file doesn't exist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

export function loadEnv(path = '.env'): void {
  if (loaded) return;
  loaded = true;

  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) return;

  for (const rawLine of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // never override the real environment

    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    if (quoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
}
