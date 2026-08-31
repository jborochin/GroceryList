/**
 * Triage the caption corpus: parse every saved caption and report output that
 * looks wrong, grouped by the kind of wrongness.
 *
 * You cannot hand-write expected output for hundreds of captions. You can,
 * however, recognise broken output without knowing the right answer — a digit
 * left inside an ingredient name is a quantity the parser dropped, an ` & `
 * between two nouns is usually two ingredients on one line. So this reviews the
 * few percent that smell, and you fix classes rather than instances.
 *
 * Usage:
 *   npm run ig:audit                          # grouped report over every caption
 *   npm run ig:audit -- --errors              # only the near-certain breakage
 *   npm run ig:audit -- --smell two-in-one    # drill into one class
 *   npm run ig:audit -- --fixture creamy      # one caption, all its flags
 *   npm run ig:audit -- --full                # every occurrence, not a sample
 *   npm run ig:audit -- --update-baseline     # accept current output as the snapshot
 */
import {
  Smell,
  analyzeCaption,
  buildBaseline,
  listCaptions,
  readCaption,
  smellsFor,
  writeBaseline,
} from './lib/captionCorpus';

const SAMPLE = 6;

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--update-baseline')) {
    const baseline = buildBaseline();
    writeBaseline(baseline);
    console.log(`Baseline written for ${Object.keys(baseline).length} captions.`);
    console.log('Review the diff before committing — it is the record of what the parser does.');
    return;
  }

  const errorsOnly = args.includes('--errors');
  const full = args.includes('--full');
  const smellFilter = argValue(args, '--smell');
  const fixtureFilter = argValue(args, '--fixture');

  const names = listCaptions().filter((n) => !fixtureFilter || n.includes(fixtureFilter));
  if (names.length === 0) {
    console.error('No captions found. Harvest some first: npm run ig:harvest -- --from urls.txt');
    process.exit(1);
  }

  const flagged: Array<Smell & { fixture: string }> = [];
  const unparsed: Array<[string, string]> = [];
  let ingredientCount = 0;

  for (const name of names) {
    const analysis = analyzeCaption(readCaption(name));
    if (analysis.digest.error) {
      unparsed.push([name, analysis.digest.error]);
      continue;
    }
    ingredientCount += analysis.ingredients.length;
    for (const smell of smellsFor(analysis)) {
      if (errorsOnly && smell.severity !== 'error') continue;
      if (smellFilter && smell.smell !== smellFilter) continue;
      flagged.push({ ...smell, fixture: name });
    }
  }

  const parsed = names.length - unparsed.length;
  console.log(
    `\n${names.length} captions — ${parsed} parsed (${ingredientCount} ingredients), ${unparsed.length} did not.`,
  );

  const bySmell = new Map<string, Array<Smell & { fixture: string }>>();
  for (const f of flagged) bySmell.set(f.smell, [...(bySmell.get(f.smell) ?? []), f]);

  const ordered = [...bySmell.entries()].sort((a, b) => {
    const sev = (list: Smell[]) => (list[0].severity === 'error' ? 0 : 1);
    return sev(a[1]) - sev(b[1]) || b[1].length - a[1].length;
  });

  console.log(`${flagged.length} flags in ${bySmell.size} classes\n`);
  for (const [smell, list] of ordered) {
    const badge = list[0].severity === 'error' ? 'ERROR' : 'warn ';
    console.log(`── ${badge}  ${smell} (${list.length})`);
    console.log(`   ${list[0].hint}`);
    const shown = full ? list : list.slice(0, SAMPLE);
    for (const f of shown) console.log(`     ${f.fixture.slice(0, 26).padEnd(28)} ${f.detail}`);
    if (!full && list.length > shown.length) {
      console.log(`     … ${list.length - shown.length} more (--full, or --smell ${smell})`);
    }
    console.log('');
  }

  if (unparsed.length > 0) {
    // Not a failure. Roughly one recipe reel in three keeps the recipe in the
    // video or a link in bio, and those land in the app's paste-the-caption box.
    console.log(`── captions with no recipe (${unparsed.length})`);
    console.log('   Routine — these route to the paste fallback in the app.');
    for (const [name, error] of unparsed.slice(0, full ? unparsed.length : SAMPLE)) {
      console.log(`     ${name.slice(0, 26).padEnd(28)} ${error.slice(0, 60)}`);
    }
    console.log('');
  }

  const errors = flagged.filter((f) => f.severity === 'error').length;
  console.log(
    `${errors} error-level flags across ${parsed} parsed captions` +
      `${parsed > 0 ? ` (${(errors / parsed).toFixed(1)} per caption)` : ''}.`,
  );
}

main();
