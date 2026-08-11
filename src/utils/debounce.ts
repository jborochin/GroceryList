/**
 * Call `fn` only once the caller has stopped calling for `waitMs`.
 *
 * The grocery pipeline recomputes on every plan, pantry, manual-item and override
 * change, so anything reacting to the materialized item list fires in bursts —
 * adding a recipe can produce a dozen renders in a second. Network work hung off
 * that list needs to see the settled result, not each intermediate one.
 *
 * Trailing-edge only, on purpose: the last call carries the complete list, and an
 * immediate leading call would fire with a half-built one.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: A): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };

  // Callers unmounting mid-wait need a way to drop the pending invocation rather
  // than let it fire against a torn-down component.
  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return debounced;
}
