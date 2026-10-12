import { renderToStaticMarkup } from 'react-dom/server';
import type { AdChargeAdminView, AdChargeBatchView } from '@precommunity/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordMarketChargesPanel } from './keyword-market-charges-panel';

const state = vi.hoisted(() => ({ value: {} as any, hook: vi.fn() }));
vi.mock('@/hooks/use-keyword-market-charges', () => ({
  useKeywordMarketCharges: (canManage: boolean) => {
    state.hook(canManage);
    return state.value;
  },
}));
const history: AdChargeBatchView = {
  id: 'charge-1',
  runId: 'run-1',
  chargeId: `0x${'33'.repeat(32)}`,
  chainId: 84532,
  contractAddress: `0x${'11'.repeat(20)}`,
  keywordId: `0x${'44'.repeat(32)}`,
  keyword: 'search',
  stakerAddress: `0x${'22'.repeat(20)}`,
  positionVersion: '9007199254740995',
  clickCount: 3,
  duePreRaw: '1000000000000000001',
  requestedPreRaw: '1000000000000000000',
  chargedPreRaw: '1000000000000000000',
  shortfallPreRaw: '1',
  status: 'PARTIAL',
  txHash: `0x${'55'.repeat(32)}`,
  errorCode: 'INSUFFICIENT_STAKE',
  createdAt: '2026-10-11T10:00:00.000Z',
  updatedAt: '2026-10-11T10:00:00.000Z',
};

function view(): AdChargeAdminView {
  return {
    chainId: 84532,
    contractAddress: history.contractAddress,
    quoteStatus: 'FRESH',
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
      signerAddress: history.stakerAddress,
      operatorAddress: history.stakerAddress,
      gasBalanceRaw: '100000000000000000',
      workerHeartbeatAt: history.createdAt,
    },
    pending: {
      clicks: 4,
      preRaw: '1000000000000000001',
      usdRaw: '1234567',
      awaitingPriceClicks: 1,
      captureErrors: 0,
    },
    history: [history],
    nextCursor: null,
    latestRun: null,
  };
}

describe('stake charge admin panel', () => {
  beforeEach(() => {
    state.hook.mockClear();
    state.value = {
      view: view(),
      loading: false,
      pending: false,
      runState: null,
      saving: false,
      loadingMore: false,
      notice: null,
      run: vi.fn(),
      save: vi.fn(),
      more: vi.fn(),
    };
  });

  it('shows exact amounts, partial shortfalls, stake version and chain-specific transaction', () => {
    const html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
    expect(html).toContain('1.000000000000000001');
    expect(html).toContain('1.234567');
    expect(html).toContain('stake v9007199254740995');
    expect(html).toContain('Uncollected: 0.000000000000000001');
    expect(html).toContain('href="https://sepolia.basescan.org/tx/');
    expect(html).toContain('part of the debt could not be collected');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('value="10"');
    expect(html).toContain('value="50"');
  });

  it('keeps stored PRE charges available while USD debt waits for a fresh quote', () => {
    state.value.view.quoteStatus = 'STALE';
    const html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
    expect(html).toContain('Recorded PRE amounts can still be charged');
    expect(html).toContain('Charge now');
    expect(html).not.toContain('disabled=""');
  });

  it.each(['BLOCKED', 'WORKER_UNAVAILABLE', 'WAITING_CONFIRMATION'] as const)(
    'disables charging for %s with a concrete reason',
    (status) => {
      state.value.view.readiness.status = status;
      state.value.view.readiness.errorCode = status === 'BLOCKED' ? 'OPERATOR_MISMATCH' : status;
      const html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Charge now/s);
      expect(html).toContain(
        status === 'BLOCKED'
          ? 'not the contract operator'
          : status === 'WORKER_UNAVAILABLE'
            ? 'charge worker is unavailable'
            : 'waiting for blockchain confirmation',
      );
    },
  );

  it('offers read-only history to other admins', () => {
    const html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage={false} />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Save settings');
    expect(html).toContain('Only SUPER_ADMIN');
    expect(html).toContain('PARTIAL');
    expect(state.hook).toHaveBeenCalledWith(false);
  });

  it('shows in-progress runs without a successful-charge message', () => {
    state.value.pending = true;
    state.value.runState = 'QUEUED';
    let html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
    expect(html).toContain('Waiting for worker');
    expect(html).not.toContain('routine completed');
    state.value.runState = 'RUNNING';
    html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
    expect(html).toContain('Charging…');
  });

  it('shows a mainnet transaction link and a persisted queue failure without secret material', () => {
    state.value.view.history = [{ ...history, chainId: 8453 }];
    state.value.view.latestRun = {
      jobId: 'run-1',
      trigger: 'MANUAL',
      status: 'QUEUED',
      errorCode: 'QUEUE_UNAVAILABLE',
      createdAt: history.createdAt,
      startedAt: null,
      finishedAt: null,
      batches: [],
    };
    const html = renderToStaticMarkup(<KeywordMarketChargesPanel canManage />);
    expect(html).toContain('href="https://basescan.org/tx/');
    expect(html).toContain('charge queue is unavailable');
    expect(html).not.toContain('signedTransaction');
  });
});
