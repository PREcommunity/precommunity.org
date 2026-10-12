import { useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalSummary } from '@precommunity/shared';
import { getAddress, maxUint256 } from 'viem';
import { activeChain, activeDeployment } from '@/lib/deployment';
import { ContributionPanel } from './contribution-panel';

const mocks = vi.hoisted(() => ({
  buttons: new Map<string, () => void>(),
  read: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
}));
const account = `0x${'22'.repeat(20)}` as const;
const contributionHash = `0x${'33'.repeat(32)}` as const;
const approvalHash = `0x${'44'.repeat(32)}` as const;

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('@precommunity/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@precommunity/shared')>()),
  isDeploymentConfigured: () => true,
}));
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: `0x${'22'.repeat(20)}`,
    chainId: 84532,
    isConnected: true,
    status: 'connected',
  }),
  usePublicClient: () => ({
    readContract: mocks.read,
    waitForTransactionReceipt: mocks.receipt,
  }),
  useReadContract: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));
vi.mock('./action-button', () => ({
  ActionButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
    if (onClick) mocks.buttons.set(String(children), onClick);
    return null;
  },
}));

const goal: GoalSummary = {
  id: 'goal',
  goalId: 'goal',
  slug: 'goal',
  title: 'Goal',
  description: '',
  chainGoalId: `0x${'11'.repeat(32)}`,
  recipientAddress: account,
  creatorAddress: account,
  goalType: 'ONE_TIME',
  deadline: '2100-01-01T00:00:00.000Z',
  creationTxHash: contributionHash,
  creationBlock: '1',
  metadataStatus: 'NOT_SET',
  documents: [],
  status: 'OPEN',
  progress: ['PRE', 'USDC'].map((asset) => ({
    asset: asset as 'PRE' | 'USDC',
    target: '100',
    funded: '0',
    released: '0',
    surplus: '0',
    percent: 0,
  })),
};

let cells: Array<{ value: unknown; set: (value: unknown) => void }>;
function renderPanel() {
  let index = 0;
  vi.mocked(useState).mockImplementation((() => {
    const cell = cells[index++]!;
    return [cell.value, cell.set];
  }) as typeof useState);
  return renderToStaticMarkup(<ContributionPanel goal={goal} />);
}
async function contribute(asset: 'PRE' | 'USDC', balance: bigint, allowance: bigint) {
  cells[0]!.value = asset;
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === 'balanceOf' ? balance : allowance,
  );
  renderPanel();
  await mocks.buttons.get(`Contribute ${asset}`)!();
}

describe('contribution token approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buttons.clear();
    cells = ['PRE', '1', 'ANONYMOUS', 'Estimated in wallet', 'idle', ''].map((value) => {
      const cell = {
        value: value as unknown,
        set: (next: unknown) => {
          cell.value = typeof next === 'function' ? next(cell.value) : next;
        },
      };
      return cell;
    });
    mocks.write.mockResolvedValue(contributionHash);
    mocks.receipt.mockResolvedValue({ status: 'success', transactionHash: contributionHash });
  });

  describe.each([
    ['PRE', 10n ** 18n, activeDeployment.preAddress],
    ['USDC', 10n ** 6n, activeDeployment.usdcAddress],
  ] as const)('%s', (asset, rawAmount, token) => {
    it.each(['equal', 'sufficient', 'unlimited'] as const)(
      'contributes directly with %s allowance',
      async (kind) => {
        const allowance =
          kind === 'unlimited' ? maxUint256 : kind === 'equal' ? rawAmount : rawAmount * 2n;
        await contribute(asset, rawAmount * 2n, allowance);
        expect(mocks.read).toHaveBeenCalledWith(
          expect.objectContaining({
            address: getAddress(token),
            functionName: 'allowance',
            args: [account, getAddress(activeDeployment.escrowAddress)],
          }),
        );
        expect(mocks.write).toHaveBeenCalledOnce();
        expect(mocks.write).toHaveBeenCalledWith(
          expect.objectContaining({
            address: getAddress(activeDeployment.escrowAddress),
            functionName: 'contribute',
            args: [goal.chainGoalId, getAddress(token), rawAmount, false],
            chainId: activeChain.id,
          }),
        );
        expect(mocks.receipt).toHaveBeenCalledOnce();
        expect(mocks.receipt).toHaveBeenCalledWith({
          hash: contributionHash,
          confirmations: activeDeployment.confirmations,
        });
        expect(cells[4]!.value).toBe('confirmed');
      },
    );

    it('approves only the requested amount when allowance is insufficient', async () => {
      mocks.write.mockResolvedValueOnce(approvalHash);
      await contribute(asset, rawAmount * 2n, rawAmount - 1n);
      expect(mocks.write).toHaveBeenCalledTimes(2);
      expect(mocks.write).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          address: getAddress(token),
          functionName: 'approve',
          args: [getAddress(activeDeployment.escrowAddress), rawAmount],
          chainId: activeChain.id,
        }),
      );
      expect(mocks.write).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ functionName: 'contribute' }),
      );
      expect(mocks.receipt).toHaveBeenNthCalledWith(1, {
        hash: approvalHash,
        confirmations: 3,
      });
      expect(cells[4]!.value).toBe('confirmed');
    });

    it('does not approve or contribute when the balance is insufficient', async () => {
      await contribute(asset, rawAmount - 1n, 0n);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.receipt).not.toHaveBeenCalled();
      expect(cells[5]!.value).toBe(`Insufficient ${asset} balance for this contribution.`);
    });
  });

  it('stops if allowance cannot be read', async () => {
    mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'allowance') throw new Error('RPC unavailable');
      return 10n ** 18n;
    });
    renderPanel();
    await mocks.buttons.get('Contribute PRE')!();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(cells[4]!.value).toBe('error');
    expect(cells[5]!.value).toBe('RPC unavailable');
  });

  it('does not contribute after a reverted approval', async () => {
    mocks.receipt.mockResolvedValueOnce({ status: 'reverted', transactionHash: approvalHash });
    await contribute('PRE', 10n ** 18n, 0n);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'approve' }));
    expect(cells[4]!.value).toBe('error');
    expect(cells[5]!.value).toBe('Token approval reverted on-chain');
  });
});
