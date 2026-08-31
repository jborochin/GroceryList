import {
  digestCaption,
  listCaptions,
  readBaseline,
  readCaption,
} from '../../scripts/lib/captionCorpus';

// Breadth cover for the caption parser.
//
// instagramCaptionCorpus.test.ts asserts exact expected values, which only
// scales to a handful of hand-reviewed captions. This one asserts nothing about
// what is *correct* — it pins what the parser currently *does* across every
// saved caption, so a fix aimed at one creator cannot silently change the
// output for another without showing up here.
//
// When a diff is intentional, accept it:
//   npm run ig:audit -- --update-baseline
// and read the resulting git diff — that is the actual review step.
describe('caption parse baseline', () => {
  const baseline = readBaseline();
  const names = listCaptions();

  it('has a baseline to compare against', () => {
    expect(baseline).not.toBeNull();
  });

  if (!baseline) return;

  it('covers every saved caption', () => {
    // A harvested caption with no baseline entry is untested; a baseline entry
    // with no caption is a fixture someone deleted without regenerating.
    expect(names.filter((n) => !baseline[n])).toEqual([]);
    expect(Object.keys(baseline).filter((n) => !names.includes(n))).toEqual([]);
  });

  describe.each(names)('%s', (name) => {
    it('parses the same as the baseline', () => {
      expect(digestCaption(readCaption(name))).toEqual(baseline[name]);
    });
  });
});
