import { useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdCampaignView } from '@precommunity/shared';
import { activeChain, activeDeployment, activeExplorerTransaction } from '@/lib/deployment';
import { ApiError } from '@/lib/http';
import type { AdStakeTransactionPlan, KeywordMarketChainSnapshot } from '@/lib/keyword-market-api';
import { KeywordMarketCampaignDetail } from './keyword-market-campaign-detail';

const mocks = vi.hoisted(() => ({
  buttons: new Map<string, () => void>(),
  account: { address: '', isConnected: true },
  send: vi.fn(),
  receipt: vi.fn(),
  read: vi.fn(),
  prepare: vi.fn(),
  status: vi.fn(),
  campaigns: vi.fn(),
  projection: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  usePublicClient: () => ({
    readContract: mocks.read,
    waitForTransactionReceipt: mocks.receipt,
  }),
  useSendTransaction: () => ({ sendTransactionAsync: mocks.send }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock('wagmi/actions', () => ({ getAccount: () => mocks.account }));
vi.mock('@/hooks/use-wallet-session', () => ({
  useWalletSession: () => ({
    isConnected: true,
    address: `0x${'22'.repeat(20)}`,
    sessionAddress: `0x${'22'.repeat(20)}`,
    chainId: 84532,
  }),
}));
vi.mock('@/hooks/use-keyword-market-refresh', () => ({ useKeywordMarketRefresh: () => {} }));
vi.mock('./form-validation', () => ({
  useFormValidation: () => ({}),
  FormFieldError: () => null,
}));
vi.mock('./action-button', () => ({
  ActionButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
    if (onClick) mocks.buttons.set(String(children), onClick);
    return null;
  },
}));
vi.mock('@/lib/keyword-market-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/keyword-market-api')>()),
  prepareAdStakeBid: mocks.prepare,
  getKeywordMarketStatus: mocks.status,
  getMyAdCampaigns: mocks.campaigns,
  getAdTransactionProjection: mocks.projection,
}));

const staker = `0x${'22'.repeat(20)}` as const;
const otherStaker = `0x${'33'.repeat(20)}` as const;
const token = `0x${'44'.repeat(20)}` as const;
const market = `0x${'55'.repeat(20)}` as const;
const hash = `0x${'66'.repeat(32)}` as const;
const approvalHash = `0x${'77'.repeat(32)}` as const;
const blockHash = `0x${'88'.repeat(32)}` as const;
const campaign: AdCampaignView = {
  id: 'campaign',
  keyword: 'bitcoin',
  paused: false,
  chainStatus: 'SYNCED',
  position: null,
  leaderBidUsdRaw: null,
  bidNeededToLeadUsdRaw: null,
  activeRevision: null,
  pendingRevision: null,
  revisions: [],
  lifetimeViews: '0',
  lifetimeClicks: '0',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
const snapshot: KeywordMarketChainSnapshot = {
  status: 'SYNCED',
  chainId: activeChain.id,
  contractAddress: market,
  deploymentBlock: '1',
  transactionsEnabled: true,
  indexedThroughBlock: '100',
  minimumStakeRaw: '1000000000000000000',
  preTokenAddress: token,
};
const plan: AdStakeTransactionPlan = {
  enabled: true,
  status: 'READY',
  operation: 'STAKE',
  keywordId: `0x${'99'.repeat(32)}`,
  tokenAddress: token,
  approvalTransaction: { chainId: activeChain.id, to: token, data: '0x1234', valueRaw: '0' },
  transaction: { chainId: activeChain.id, to: market, data: '0x5678', valueRaw: '0' },
};
const confirmedReceipt = {
  status: 'success',
  transactionHash: hash,
  blockNumber: 100n,
  blockHash,
};

// The existing server-render test pattern can exercise handlers without a DOM dependency.
let cells: Array<{ value: unknown; set: (value: unknown) => void }>;
function renderCampaign() {
  let index = 0;
  vi.mocked(useState).mockImplementation((() => {
    const cell = cells[index++]!;
    return [cell.value, cell.set];
  }) as typeof useState);
  return renderToStaticMarkup(<KeywordMarketCampaignDetail campaignId={campaign.id} />);
}
function submitStake() {
  renderCampaign();
  mocks.buttons.get('Stake')!();
}
async function finishTransaction() {
  await vi.waitFor(() => expect(cells[3]!.value).toBe(''));
}

describe('keyword campaign transaction safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buttons.clear();
    mocks.account.address = staker;
    mocks.account.isConnected = true;
    cells = [
      campaign,
      'ready',
      '',
      '',
      '1',
      '0.10',
      Math.floor(Date.now() / 1000),
      snapshot,
      '',
      null,
      false,
      { headline: '', description: '', destinationUrl: '' },
    ].map((value) => {
      const cell = {
        value,
        set: (next: unknown) => {
          cell.value = typeof next === 'function' ? next(cell.value) : next;
        },
      };
      return cell;
    });
    mocks.prepare.mockResolvedValue(plan);
    mocks.send.mockResolvedValue(hash);
    mocks.receipt.mockResolvedValue(confirmedReceipt);
    mocks.read.mockResolvedValue(10n ** 20n);
    mocks.status.mockResolvedValue(snapshot);
    mocks.campaigns.mockResolvedValue([campaign]);
    mocks.projection.mockResolvedValue({
      chainStatus: 'SYNCED',
      indexed: true,
      blockNumber: '100',
      blockHash,
    });
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not sign after the active account changes during preparation', async () => {
    mocks.prepare.mockImplementationOnce(async () => {
      mocks.account.address = otherStaker;
      return plan;
    });
    submitStake();
    await finishTransaction();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(cells[2]!.value).toContain('wallet account changed');
    expect(cells[4]!.value).toBe('1');
  });

  it('does not send the stake after the active account changes following approval', async () => {
    mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? 0n : 10n ** 20n,
    );
    mocks.send.mockResolvedValueOnce(approvalHash);
    mocks.receipt.mockImplementationOnce(async () => {
      mocks.account.address = otherStaker;
      return { ...confirmedReceipt, transactionHash: approvalHash };
    });
    submitStake();
    await finishTransaction();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ account: staker, to: token }),
    );
    expect(cells[2]!.value).toContain('wallet account changed');
    expect(cells[4]!.value).toBe('1');
  });

  it('pins the campaign wallet as sender and clears the deposit after confirmation', async () => {
    submitStake();
    await finishTransaction();
    expect(mocks.send).toHaveBeenCalledWith({
      account: staker,
      to: market,
      data: plan.transaction.data,
      value: 0n,
      chainId: activeChain.id,
    });
    expect(mocks.receipt).toHaveBeenCalledWith({
      hash,
      confirmations: activeDeployment.confirmations,
    });
    expect(cells[4]!.value).toBe('');
    expect(renderCampaign()).toContain('Position updated and indexed.');
  });

  it.each([0, 429, 503])('retries transient indexing failures with status %s', async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
    mocks.projection.mockRejectedValueOnce(new ApiError('Index temporarily unavailable', status));
    submitStake();
    await vi.waitFor(() => expect(mocks.projection).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(2_000);
    await finishTransaction();
    expect(mocks.projection).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(cells[2]!.value).toBe('');
    expect(cells[4]!.value).toBe('');
    expect(renderCampaign()).toContain('Position updated and indexed.');
  });

  it('preserves confirmation, transaction proof and cleared PRE amount on a permanent indexing error', async () => {
    mocks.projection.mockRejectedValueOnce(new ApiError('Session expired', 401));
    submitStake();
    await finishTransaction();
    expect(mocks.projection).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(cells[2]!.value).toBe('');
    expect(cells[4]!.value).toBe('');
    const html = renderCampaign();
    expect(html).toContain('Transaction confirmed. Marketplace data is temporarily unavailable');
    expect(html).toContain(`href="${activeExplorerTransaction(hash)}"`);
  });

  it('reports a reverted final receipt as failure and retains the unspent PRE amount', async () => {
    mocks.receipt.mockResolvedValueOnce({ ...confirmedReceipt, status: 'reverted' });
    submitStake();
    await finishTransaction();
    expect(mocks.projection).not.toHaveBeenCalled();
    expect(cells[2]!.value).toBe('Keyword Market transaction reverted on-chain');
    expect(cells[4]!.value).toBe('1');
    expect(renderCampaign()).not.toContain('Transaction confirmed.');
  });
});
