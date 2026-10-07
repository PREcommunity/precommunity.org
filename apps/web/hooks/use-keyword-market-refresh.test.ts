import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeywordMarketRefresh } from './use-keyword-market-refresh';

const effect = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({
  useEffect: (callback: () => (() => void) | undefined) => {
    effect.cleanup = callback();
  },
}));

describe('keyword market background refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    effect.cleanup = undefined;
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      }),
    );
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  });

  afterEach(() => {
    effect.cleanup?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('refreshes the API in the background on each visible interval and focus', () => {
    const refresh = vi.fn(async () => undefined);
    useKeywordMarketRefresh(refresh, true);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it('stops hidden polling and refreshes when the tab becomes visible again', () => {
    const refresh = vi.fn(async () => undefined);
    useKeywordMarketRefresh(refresh, true);
    Object.assign(document, { visibilityState: 'hidden' });
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('removes listeners and timers when the view closes', () => {
    const refresh = vi.fn(async () => undefined);
    useKeywordMarketRefresh(refresh, true);
    effect.cleanup?.();
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not poll before the view is ready or during a transaction', () => {
    const refresh = vi.fn(async () => undefined);
    useKeywordMarketRefresh(refresh, false);
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
