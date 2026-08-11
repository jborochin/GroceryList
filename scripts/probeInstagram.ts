/**
 * Fetch a live Instagram reel or post and print what the importer makes of it.
 *
 * The share extension only runs in a native build, so this is how the fetch →
 * caption → recipe path gets exercised during development without waiting on an
 * EAS build. It calls the same importInstagramRecipe the app calls.
 *
 * Usage:
 *   npm run ig:probe -- https://www.instagram.com/reel/C_LYHf-uByQ/
 *   npm run ig:probe -- <url> --caption     # also dump the raw caption
 */
import { importInstagramRecipe, InstagramImportError } from '../src/utils/instagramImport';
import { parseSharedUrl } from '../src/utils/instagramUrl';

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showCaption = args.includes('--caption');
  const url = args.find((a) => !a.startsWith('--'));

  if (!url) {
    console.error('Usage: npm run ig:probe -- <instagram-url> [--caption]');
    process.exit(1);
  }

  const target = parseSharedUrl(url);
  console.log(`\nInput     : ${url}`);
  console.log(`Classified: ${target.kind}${target.kind === 'instagram' ? ` (shortcode ${target.shortcode ?? 'unknown — /share/ redirect'})` : ''}`);
  if (target.kind !== 'instagram') {
    console.error('\nNot an Instagram post or reel URL — nothing to probe.');
    process.exit(1);
  }

  try {
    const recipe = await importInstagramRecipe(url);
    console.log(`\n=== ${recipe.title} ===`);
    console.log(`Servings  : ${recipe.servings}`);
    console.log(`Source    : ${recipe.sourceUrl ?? '(none)'}`);
    console.log(`Image     : ${recipe.imageUrl ?? '(none)'}`);

    console.log(`\nIngredients (${recipe.ingredients.length}):`);
    for (const ingredient of recipe.ingredients) {
      const qty = `${formatQuantity(ingredient.quantity)} ${ingredient.unit}`;
      console.log(`  ${qty.padEnd(12)} ${ingredient.name}`);
    }

    const steps = recipe.instructions ?? [];
    console.log(`\nInstructions (${steps.length}):`);
    steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));

    // The quantity-less items are the ones a user would have to fix by hand, so
    // surfacing the count makes parser regressions obvious at a glance.
    const unquantified = recipe.ingredients.filter(
      (i) => i.unit === 'each' && i.quantity === 1,
    ).length;
    console.log(
      `\n${recipe.ingredients.length - unquantified}/${recipe.ingredients.length} ingredients carry an explicit quantity.`,
    );
  } catch (err) {
    if (err instanceof InstagramImportError) {
      console.error(`\nImport failed [${err.kind}]: ${err.message}`);
      if (err.recoveredCaption) {
        console.error(
          '\nThe caption WAS readable but held no parseable ingredient list — in the app this\n' +
            'lands in the editable paste box. Recovered text:\n',
        );
        console.error(err.recoveredCaption);
      }
      process.exit(2);
    }
    throw err;
  }

  if (showCaption) {
    console.log('\n--- raw caption ---');
    try {
      const { extractCaptionFromHtml } = await import('../src/utils/instagramCaption');
      const res = await fetch(target.url, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });
      const extracted = extractCaptionFromHtml(await res.text());
      console.log(extracted?.caption ?? '(none)');
    } catch (err) {
      console.log(`(could not re-fetch: ${err instanceof Error ? err.message : err})`);
    }
  }
}

main().catch((err) => {
  console.error('probeInstagram failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
