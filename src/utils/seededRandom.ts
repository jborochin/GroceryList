// Tiny, dependency-free seeded PRNG. `mulberry32` is a well-known 32-bit
// generator: fast, good enough distribution for picking among meal candidates,
// and fully reproducible — the same seed always yields the same sequence.
//
// Used by the meal planner's "Shuffle" path so a generated plan can vary while
// staying reproducible (a given seed re-creates the exact same plan). The
// seedless planner path never calls this, so its determinism is unaffected.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
