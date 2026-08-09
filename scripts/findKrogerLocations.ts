/**
 * One-off setup helper: find Kroger store IDs to use as pricing reference points.
 *
 * The Products API only returns a price when given a filter.locationId, so the
 * refresh job needs a handful of store IDs. Pick 3 in different regions and put
 * them in KROGER_LOCATION_IDS — the job takes the median across them so one
 * store's promo or stockout can't move the national estimate.
 *
 * Credentials come from the environment or the repo-root `.env`.
 *
 * Usage:
 *   npm run prices:find-locations 45202 30303 98101
 */
import { KrogerClient } from './lib/krogerClient';
import { loadEnv } from './lib/loadEnv';

/**
 * The Locations API also returns logistics pseudo-locations — forecast sheds,
 * transport spokes, unused slots. They carry no shelf prices, so using one as a
 * reference store would quietly contribute nothing to the median.
 */
const NON_RETAIL = /\b(?:spoke|forecast|shed|trans|unused|warehouse|distribution|dc)\b/i;

async function main(): Promise<void> {
  loadEnv();

  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  if (zips.length === 0) {
    console.error('Usage: npm run prices:find-locations <zip> [zip...]');
    process.exit(1);
  }

  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must both be set.');
    process.exit(1);
  }

  const kroger = new KrogerClient(clientId, clientSecret);

  for (const zip of zips) {
    const found = await kroger.findLocations(zip, 10);
    const locations = found.filter((l) => !NON_RETAIL.test(`${l.name ?? ''} ${l.chain ?? ''}`));
    console.log(`\n${zip}:`);
    if (locations.length === 0) {
      console.log('  (no retail Kroger-family stores found near this ZIP)');
      continue;
    }
    for (const l of locations) {
      const where = [l.address?.city, l.address?.state].filter(Boolean).join(', ');
      console.log(`  ${l.locationId}  ${l.chain ?? ''} ${l.name ?? ''} — ${where}`);
    }
  }

  console.log('\nSet one per region, e.g.:');
  console.log('  KROGER_LOCATION_IDS=01400943,01800555,70100055');
}

main().catch((err) => {
  console.error('findKrogerLocations failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
