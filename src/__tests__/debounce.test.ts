import { debounce } from '../utils/debounce';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('debounce', () => {
  it('does not call through before the wait elapses', () => {
    const fn = jest.fn();
    debounce(fn, 1000)();
    jest.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into one trailing call', () => {
    const fn = jest.fn();
    const d = debounce(fn, 1000);
    for (let i = 0; i < 12; i += 1) {
      d(i);
      jest.advanceTimersByTime(50);
    }
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    // The final call wins: it carries the settled list, not a half-built one.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(11);
  });

  it('fires again for a burst that arrives after the first settled', () => {
    const fn = jest.fn();
    const d = debounce(fn, 1000);
    d('a');
    jest.advanceTimersByTime(1000);
    d('b');
    jest.advanceTimersByTime(1000);
    expect(fn.mock.calls).toEqual([['a'], ['b']]);
  });

  it('drops a pending call when cancelled', () => {
    const fn = jest.fn();
    const d = debounce(fn, 1000);
    d();
    d.cancel();
    jest.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('is safe to cancel when nothing is pending', () => {
    const d = debounce(jest.fn(), 1000);
    expect(() => d.cancel()).not.toThrow();
  });
});
