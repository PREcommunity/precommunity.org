import type { PreUsdPriceAdminView } from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { usePreUsdPrice } from './use-pre-usd-price';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: (next: unknown) => void }>,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => (() => void) | undefined>,
  stateIndex: 0,
  refIndex: 0,
}));
const api = vi.hoisted(() => vi.fn());

vi.mock('react', () => ({
  useEffect: (callback: () => (() => void) | undefined) => hooks.effects.push(callback),
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    const cell = (hooks.states[index] ??= {
      value: initial,
      update: (next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      },
    });
    return [cell.value, cell.update];
  },
}));
vi.mock('@/lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http')>()),
  clientApiJson: api,
}));

const quote: PreUsdPriceAdminView = {
  status: 'FRESH',
  collectorEnabled: true,
  quote: {
    id: 'quote-1',
    source: 'COINGECKO',
    assetId: 'presearch',
    priceUsd: '0.004567890123456789',
    quotedAt: '2026-10-09T10:00:00.000Z',
    fetchedAt: '2026-10-09T10:01:00.000Z',
  },
};

function renderPriceState(canRefresh = true) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  return PriceState(canRefresh);
}

function PriceState(canRefresh: boolean) {
  return usePreUsdPrice(canRefresh);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('PRE price panel data', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:01:00.000Z'));
    hooks.states.length = 0;
    hooks.refs.length = 0;
    api.mockReset();
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    api.mockImplementation(async (path: string, options: RequestInit) => {
      if (options.method === 'POST') return { jobId: 'manual-1' };
      if (path.includes('/refresh/')) return { jobId: 'manual-1', status: 'QUEUED', result: null };
      return quote;
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount(canRefresh = true) {
    renderPriceState(canRefresh);
    cleanup = hooks.effects[0]!();
    await vi.advanceTimersByTimeAsync(0);
    return renderPriceState(canRefresh);
  }

  function statusCalls() {
    return api.mock.calls.filter(([path]) => String(path).includes('/refresh/'));
  }

  it('loads the exact price string without caching or numeric conversion', async () => {
    const panel = await mount();
    expect(panel.view).toEqual(quote);
    expect(panel.loading).toBe(false);
    expect(api).toHaveBeenCalledWith(
      '/v1/admin/pre-usd-price',
      { cache: 'no-store', signal: expect.any(AbortSignal) },
      'PRE price',
    );
  });

  it('refreshes visible prices every minute and resumes after a hidden tab', async () => {
    await mount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(2);
    Object.assign(document, { visibilityState: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api).toHaveBeenCalledTimes(2);
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('shares an in-flight read when visibility and periodic refresh coincide', async () => {
    await mount();
    const reading = deferred<PreUsdPriceAdminView>();
    api.mockReturnValueOnce(reading.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(2);
    reading.resolve(quote);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('queues only once during repeated clicks and never claims a queued task succeeded', async () => {
    const panel = await mount();
    await Promise.all([panel.refresh(), panel.refresh()]);
    expect(api.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    const waiting = renderPriceState();
    expect(waiting.pending).toBe(true);
    expect(waiting.refreshState).toBe('QUEUED');
    expect(waiting.notice).toBeNull();
  });

  it('polls every two seconds for 30 seconds then every 30 seconds', async () => {
    const panel = await mount();
    await panel.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statusCalls()).toHaveLength(15);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(statusCalls()).toHaveLength(15);
    await vi.advanceTimersByTimeAsync(1);
    expect(statusCalls()).toHaveLength(16);
  });

  it('pauses status polling in a hidden tab and checks when visible again', async () => {
    const panel = await mount();
    await panel.refresh();
    Object.assign(document, { visibilityState: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(statusCalls()).toHaveLength(0);
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(statusCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(statusCalls()).toHaveLength(2);
  });

  it('reloads the price after a completed update', async () => {
    const panel = await mount();
    await panel.refresh();
    api.mockResolvedValueOnce({
      jobId: 'manual-1',
      status: 'COMPLETED',
      result: { outcome: 'UPDATED' },
    });
    api.mockResolvedValueOnce({
      ...quote,
      quote: { ...quote.quote!, id: 'quote-2', priceUsd: '0.005' },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const completed = renderPriceState();
    expect(completed.pending).toBe(false);
    expect(completed.view?.quote?.id).toBe('quote-2');
    expect(completed.notice?.message).toBe(
      'CoinGecko quote updated. Contract publication is handled separately.',
    );
  });

  it('reloads after an older in-flight read finishes rather than showing its old price as updated', async () => {
    const panel = await mount();
    await panel.refresh();
    const oldRead = deferred<PreUsdPriceAdminView>();
    api.mockReturnValueOnce(oldRead.promise);
    document.dispatchEvent(new Event('visibilitychange'));
    api.mockResolvedValueOnce({
      jobId: 'manual-1',
      status: 'COMPLETED',
      result: { outcome: 'UPDATED' },
    });
    api.mockResolvedValueOnce({ ...quote, quote: { ...quote.quote!, id: 'quote-2' } });
    await vi.advanceTimersByTimeAsync(2_000);
    oldRead.resolve(quote);
    await vi.advanceTimersByTimeAsync(0);
    expect(renderPriceState().view?.quote?.id).toBe('quote-2');
  });

  it('keeps an unchanged stale quote visibly stale without announcing an update', async () => {
    const stale = { ...quote, status: 'STALE' };
    api.mockResolvedValueOnce(stale);
    const panel = await mount();
    await panel.refresh();
    api.mockResolvedValueOnce({
      jobId: 'manual-1',
      status: 'COMPLETED',
      result: { outcome: 'UNCHANGED' },
    });
    api.mockResolvedValueOnce(stale);
    await vi.advanceTimersByTimeAsync(2_000);
    const completed = renderPriceState();
    expect(completed.view?.status).toBe('STALE');
    expect(completed.view?.quote?.quotedAt).toBe(quote.quote!.quotedAt);
    expect(completed.notice?.message).toBe('CoinGecko has not published a newer quote.');
  });

  it('blocks manual attempts until the shared cooldown ends', async () => {
    const panel = await mount();
    await panel.refresh();
    const retryAt = new Date(Date.now() + 50_000).toISOString();
    api.mockResolvedValueOnce({
      jobId: 'manual-1',
      status: 'COMPLETED',
      result: { outcome: 'COOLDOWN', retryAt },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renderPriceState().cooldown).toBe(true);
    await renderPriceState().refresh();
    expect(api.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(47_999);
    expect(renderPriceState().cooldown).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(renderPriceState().cooldown).toBe(false);
  });

  it('preserves the recorded quote after a failed worker job', async () => {
    const panel = await mount();
    await panel.refresh();
    api.mockResolvedValueOnce({ jobId: 'manual-1', status: 'FAILED', result: null });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renderPriceState().view).toEqual(quote);
    expect(renderPriceState().pending).toBe(false);
    expect(renderPriceState().notice?.type).toBe('error');
  });

  it('does not mistake a missing result for an unchanged quote', async () => {
    const panel = await mount();
    await panel.refresh();
    api.mockResolvedValueOnce({ jobId: 'manual-1', status: 'COMPLETED', result: null });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renderPriceState().pending).toBe(false);
    expect(renderPriceState().notice?.type).toBe('error');
    expect(renderPriceState().notice?.message).not.toContain('not published a newer quote');
  });

  it('continues tracking the accepted task after a temporary status failure', async () => {
    const panel = await mount();
    await panel.refresh();
    api.mockRejectedValueOnce(new ApiError('Unavailable', 503));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renderPriceState().pending).toBe(true);
    expect(renderPriceState().notice?.message).toContain('Waiting to reconnect');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(statusCalls()).toHaveLength(2);
  });

  it('preserves the quote and reports an unavailable queue without claiming success', async () => {
    const panel = await mount();
    api.mockRejectedValueOnce(new ApiError('Price refresh queue is unavailable.', 503));
    await panel.refresh();
    expect(renderPriceState().pending).toBe(false);
    expect(renderPriceState().view).toEqual(quote);
    expect(renderPriceState().notice?.message).toBe('Price refresh queue is unavailable.');
  });

  it('does not submit for read-only roles even if the handler is invoked directly', async () => {
    const panel = await mount(false);
    await panel.refresh();
    expect(api).toHaveBeenCalledOnce();
  });

  it('does not submit when price collection is disabled', async () => {
    api.mockResolvedValueOnce({ ...quote, collectorEnabled: false });
    const panel = await mount();
    await panel.refresh();
    expect(api).toHaveBeenCalledOnce();
  });

  it('aborts requests and ignores late results when the authorized view unmounts', async () => {
    const loading = deferred<PreUsdPriceAdminView>();
    api.mockReturnValueOnce(loading.promise);
    await mount();
    const signal = api.mock.calls[0]![1].signal as AbortSignal;
    cleanup?.();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    loading.resolve(quote);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renderPriceState().view).toBeNull();
    expect(api).toHaveBeenCalledOnce();
  });

  it('clears private price data and stops requests after authorization expires', async () => {
    await mount();
    api.mockRejectedValueOnce(new ApiError('Sign in again.', 401));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renderPriceState().view).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
