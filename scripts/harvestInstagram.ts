/**
 * Fetch a batch of Instagram reels and save their captions as test fixtures.
 *
 * The corpus is the only way to test the caption parser against more than one
 * creator's formatting habits, and fetching is the slow, rate-limited, failure-
 * prone part. Do it once here; every later run of `ig:audit` and the snapshot
 * test reads from disk, offline and instantly.
 *
 * Captions are saved VERBATIM — provenance goes in captions.manifest.json, not
 * in a header comment, because readMeta's parsing is sensitive enough that
 * editing a fixture silently truncates it.
 *
 * There is no API for discovering reel URLs (oEmbed needs App Review, the Graph
 * API only covers posts you own) and scraping hashtag pages is both blocked and
 * against Instagram's terms. So the URL list is supplied by hand — your own
 * saved reels are the right source, since they are the distribution you would
 * actually import from.
 *
 * Usage:
 *   npm run ig:harvest -- --from urls.txt        # one URL per line, # for comments
 *   npm run ig:harvest -- <url> [<url> …]
 *   npm run ig:harvest -- --from urls.txt --delay 5000
 *   npm run ig:harvest -- --from urls.txt --force   # re-fetch already-saved posts
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractCaptionFromHtml } from '../src/utils/instagramCaption';
import { parseRecipeFromCaption } from '../src/utils/instagramCaptionParser';
import { parseSharedUrl } from '../src/utils/instagramUrl';
import { CAPTION_DIR, Manifest, readManifest, writeManifest } from './lib/captionCorpus';

// Same crawler identity the app uses — a browser UA gets a JS shell with no
// caption. See instagramCaption.ts; this is load-bearing, not an optimisation.
const CRAWLER_HEADERS: Record<string, string> = {
  'User-Agent': 'facebookexternalhit/1.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const DEFAULT_DELAY_MS = 3000;
const FETCH_TIMEOUT_MS = 20000;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function readUrlList(file: string): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function fetchCaption(url: string): Promise<{ caption: string; canonicalUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: CRAWLER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const extracted = extractCaptionFromHtml(await res.text());
    if (!extracted) throw new Error('no caption in meta tags (private, deleted, or age-gated)');
    return { caption: extracted.caption, canonicalUrl: extracted.canonicalUrl };
  } finally {
    clearTimeout(timer);
  }
}

/** Name the fixture after the recipe when the caption parses, else the shortcode. */
function fixtureNameFor(caption: string, shortcode: string, taken: Set<string>): string {
  let base = shortcode.toLowerCase();
  try {
    const title = parseRecipeFromCaption(caption).title;
    if (title && title !== 'Untitled Recipe') base = slugify(title) || base;
  } catch {
    // Unparseable captions still get saved — they are the interesting ones.
  }
  if (!taken.has(base)) return base;
  // Two reels can share a title; the shortcode always disambiguates.
  return `${base}-${shortcode.toLowerCase()}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const delay = Number(argValue(args, '--delay') ?? DEFAULT_DELAY_MS);
  const from = argValue(args, '--from');

  const inline = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    return args[i - 1] !== '--from' && args[i - 1] !== '--delay';
  });
  const urls = [...(from ? readUrlList(from) : []), ...inline];

  if (urls.length === 0) {
    console.error('Usage: npm run ig:harvest -- --from urls.txt [--delay 3000] [--force]');
    console.error('       npm run ig:harvest -- <instagram-url> [<url> …]');
    process.exit(1);
  }

  fs.mkdirSync(CAPTION_DIR, { recursive: true });
  const manifest: Manifest = readManifest();
  const taken = new Set(
    Object.values(manifest)
      .map((e) => e.fixture)
      .filter((f): f is string => !!f),
  );

  let saved = 0;
  let skipped = 0;
  const failures: Array<[string, string]> = [];

  for (const [i, url] of urls.entries()) {
    const target = parseSharedUrl(url);
    if (target.kind !== 'instagram') {
      failures.push([url, 'not an Instagram post or reel URL']);
      continue;
    }
    // A /share/… link has no shortcode until the fetch resolves it, so key those
    // on the URL and repair the entry once the canonical URL comes back.
    const key = target.shortcode ?? url;
    if (!force && manifest[key]?.fixture) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${urls.length}] ${key} … `);
    try {
      const { caption, canonicalUrl } = await fetchCaption(target.url);
      const canonical = canonicalUrl ? parseSharedUrl(canonicalUrl) : null;
      const shortcode =
        target.shortcode ?? (canonical?.kind === 'instagram' ? canonical.shortcode : null) ?? key;

      const name = manifest[key]?.fixture ?? fixtureNameFor(caption, shortcode, taken);
      fs.writeFileSync(path.join(CAPTION_DIR, `${name}.txt`), caption, 'utf8');
      taken.add(name);
      manifest[shortcode] = { shortcode, url: canonicalUrl ?? target.url, fixture: name };
      if (shortcode !== key) delete manifest[key];
      saved++;
      console.log(`saved as ${name}.txt (${caption.length} chars)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Recorded rather than dropped: knowing a URL was tried and why it failed
      // stops the same dead reel being re-fetched every run.
      manifest[key] = { shortcode: target.shortcode ?? '', url: target.url, failure: message };
      failures.push([key, message]);
      console.log(`FAILED — ${message}`);
    }

    if (i < urls.length - 1) await sleep(delay);
  }

  writeManifest(manifest);

  console.log(`\n${saved} saved, ${skipped} already had a fixture, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const [key, message] of failures) console.log(`  ${key.padEnd(16)} ${message}`);
    console.log(
      '\nSome failures are expected — deleted, private, or age-gated posts look the same from here.',
    );
  }
  if (saved > 0) {
    console.log('\nNext: npm run ig:audit            # triage the new captions');
    console.log('      npm run ig:audit -- --update-baseline   # accept them into the snapshot');
  }
}

main().catch((err) => {
  console.error('harvestInstagram failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
