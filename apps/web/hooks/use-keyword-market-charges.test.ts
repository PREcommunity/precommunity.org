import type { AdChargeAdminView } from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { useKeywordMarketCharges } from './use-keyword-market-charges';

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
    const cell = (hooks.states[hooks.stateIndex++] ??= {
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
const initial: AdChargeAdminView = {
  chainId: 84532,
  contractAddress: `0x${'11'.repeat(20)}`,
  quoteStatus: 'STALE',
  settings: {
    automaticEnabled: false,
    intervalMinutes: 10,
    clickThreshold: 50,
    updatedBy: null,
    updatedAt: null,
  },
  readiness: {
    status: 'READY',
    errorCode: null,
    signerAddress: null,
    operatorAddress: null,
    gasBalanceRaw: null,
    workerHeartbeatAt: '2026-10-11T10:00:00.000Z',
  },
  pending: {
    clicks: 1,
    preRaw: '1000000000000000001',
    usdRaw: '0',
    awaitingPriceClicks: 0,
    captureErrors: 0,
  },
  history: [],
  nextCursor: null,
  latestRun: null,
};
const endpoint = '/v1/admin/keyword-market/charges';

function render(canManage = true) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  return ChargeState(canManage);
}

function ChargeState(canManage: boolean) {
  return useKeywordMarketCharges(canManage);
}

describe('charge panel data', () => {
  let cleanup: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T10:00:00.000Z'));
    hooks.states.length = 0;
    hooks.refs.length = 0;
    api.mockReset();
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    api.mockImplementation(async (path: string, options: RequestInit) => {
      if (options.method === 'POST') return { jobId: 'run-1' };
      if (options.method === 'PATCH') return initial.settings;
      if (path.includes('/run/'))
        return {
          jobId: 'run-1',
          trigger: 'MANUAL',
          status: 'QUEUED',
          errorCode: null,
          batches: [],
        };
      return initial;
    });
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount(canManage = true) {
    render(canManage);
    cleanup = hooks.effects[0]!();
    await vi.advanceTimersByTimeAsync(0);
    return render(canManage);
  }

  it('loads exact amounts with no-store and follows worker readiness every 15 seconds', async () => {
    const panel = await mount();
    expect(panel.view?.pending.preRaw).toBe('1000000000000000001');
    expect(api).toHaveBeenCalledWith(
      endpoint,
      { cache: 'no-store', signal: expect.any(AbortSignal) },
      'Charge panel',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('coalesces repeated button clicks and reports queue/running states without success', async () => {
    const panel = await mount();
    await Promise.all([panel.run(), panel.run()]);
    expect(api.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(render().pending).toBe(true);
    expect(render().runState).toBe('QUEUED');
    expect(render().notice).toBeNull();
    api.mockResolvedValueOnce({
      jobId: 'run-1',
      trigger: 'MANUAL',
      status: 'RUNNING',
      errorCode: null,
      batches: [],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(render().runState).toBe('RUNNING');
  });

  it('reloads balances/history only after a persisted completed run', async () => {
    const panel = await mount();
    await panel.run();
    api.mockResolvedValueOnce({
      jobId: 'run-1',
      trigger: 'MANUAL',
      status: 'COMPLETED',
      errorCode: null,
      batches: [],
    });
    api.mockResolvedValueOnce({
      ...initial,
      pending: { ...initial.pending, clicks: 0, preRaw: '0' },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const next = render();
    expect(next.pending).toBe(false);
    expect(next.view?.pending.clicks).toBe(0);
    expect(next.notice).toEqual({ type: 'success', message: 'Charge routine completed.' });
  });

  it('keeps uncertain transactions and partial charges distinct from success', async () => {
    const panel = await mount();
    await panel.run();
    api.mockResolvedValueOnce({
      jobId: 'run-1',
      trigger: 'MANUAL',
      status: 'PARTIAL',
      errorCode: 'TRANSACTION_UNKNOWN',
      batches: [],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(render().notice?.type).toBe('info');
    expect(render().notice?.message).toContain('being reconciled');
  });

  it('resumes a persisted active run after loading the page', async () => {
    api.mockResolvedValueOnce({
      ...initial,
      latestRun: {
        jobId: 'existing',
        trigger: 'MANUAL',
        status: 'RUNNING',
        errorCode: null,
        batches: [],
      },
    });
    const panel = await mount();
    expect(panel.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api).toHaveBeenCalledWith(
      `${endpoint}/run/existing`,
      expect.anything(),
      'Charge status',
    );
  });

  it('can retry a queue error using the existing persistent run', async () => {
    const queued = {
      ...initial,
      latestRun: {
        jobId: 'existing',
        trigger: 'MANUAL' as const,
        status: 'QUEUED' as const,
        errorCode: 'QUEUE_UNAVAILABLE',
        createdAt: initial.readiness.workerHeartbeatAt!,
        startedAt: null,
        finishedAt: null,
        batches: [],
      },
    };
    api.mockResolvedValueOnce(queued);
    const panel = await mount();
    expect(panel.pending).toBe(false);
    await panel.run();
    expect(api.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });

  it('blocks unauthorized mutations and unavailable signers', async () => {
    let panel = await mount(false);
    await panel.run();
    await panel.save({ automaticEnabled: true, intervalMinutes: 5, clickThreshold: 25 });
    expect(api).toHaveBeenCalledTimes(1);
    cleanup?.();
    hooks.states.length = 0;
    hooks.refs.length = 0;
    api.mockResolvedValueOnce({
      ...initial,
      readiness: { ...initial.readiness, status: 'BLOCKED', errorCode: 'OPERATOR_MISMATCH' },
    });
    panel = await mount();
    await panel.run();
    expect(api.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  });

  it('saves both trigger settings and rereads the authoritative state', async () => {
    const panel = await mount();
    const input = { automaticEnabled: true, intervalMinutes: 5, clickThreshold: 25 };
    await panel.save(input);
    expect(api).toHaveBeenCalledWith(
      `${endpoint}/settings`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(input) }),
      'Charge settings',
    );
    expect(render().notice?.message).toBe('Charge settings saved.');
  });

  it('pauses polling when hidden and clears sensitive views after access is revoked', async () => {
    const panel = await mount();
    await panel.run();
    Object.assign(document, { visibilityState: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(2);
    api.mockRejectedValue(new ApiError('Access denied', 403));
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(render().view).toBeNull();
    const calls = api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(calls);
  });
});
