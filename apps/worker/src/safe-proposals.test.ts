import {
  FundingAsset,
  PayoutKind,
  PayoutStatus,
  SafePayoutProposalStatus,
} from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import {
  SAFE_SUBMITTING_RECOVERY_DELAY_MS,
  applyPendingSafeProposalUpdate,
  classifyMissingSafeSubmission,
  classifySafeProposal,
  executedSafeTransactionsAtNonce,
  reconcileConfirmedSafePayout,
  safeTransactionsAtNonce,
  shouldRecoverMissingSafeSubmission,
} from './safe-proposals';

const now = new Date('2026-08-15T09:00:00.000Z');
const pending = {
  confirmations: [{}],
  confirmationsRequired: 2,
  isExecuted: false,
  isSuccessful: null,
  transactionHash: null,
  executionDate: null,
};

describe('Safe payout proposal status', () => {
  it('tracks collected approvals and readiness', () => {
    expect(classifySafeProposal(pending, '4', 4n, 2, now)).toMatchObject({
      status: SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
      confirmations: 1,
      threshold: 2,
    });
    expect(
      classifySafeProposal({ ...pending, confirmations: [{}, {}] }, '4', 4n, 2, now),
    ).toMatchObject({
      status: SafePayoutProposalStatus.READY_TO_EXECUTE,
      confirmations: 2,
    });
  });

  it('marks a successful execution with its on-chain proof', () => {
    expect(
      classifySafeProposal(
        {
          ...pending,
          isExecuted: true,
          isSuccessful: true,
          transactionHash: '0xABCDEF',
          executionDate: '2026-08-15T08:59:00.000Z',
        },
        '4',
        5n,
        2,
        now,
      ),
    ).toMatchObject({
      status: SafePayoutProposalStatus.EXECUTED,
      executionTxHash: '0xabcdef',
      executedAt: new Date('2026-08-15T08:59:00.000Z'),
    });
  });

  it('keeps an executed transaction pending while Safe has no success result', () => {
    expect(
      classifySafeProposal(
        {
          ...pending,
          isExecuted: true,
          isSuccessful: null,
          transactionHash: '0xABCDEF',
          executionDate: '2026-08-15T08:59:00.000Z',
        },
        '4',
        5n,
        2,
        now,
      ),
    ).toMatchObject({
      status: SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
      failureReason: 'Safe execution result is not available yet',
      executionTxHash: '0xabcdef',
      executedAt: null,
    });
  });

  it('requires positive replacement proof before marking a nonce stale', () => {
    expect(
      classifySafeProposal({ ...pending, isExecuted: true, isSuccessful: false }, '4', 5n, 2, now),
    ).toMatchObject({
      status: SafePayoutProposalStatus.FAILED,
      failureReason: 'Safe transaction execution failed',
    });
    expect(classifySafeProposal(pending, '4', 5n, 2, now)).toMatchObject({
      status: SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
      failureReason: 'Safe nonce advanced; awaiting verified execution or replacement',
    });
    expect(classifySafeProposal(pending, '4', 5n, 2, now, true)).toMatchObject({
      status: SafePayoutProposalStatus.STALE,
      failureReason: 'A different executed Safe transaction used this nonce',
    });
  });

  it('finds only executed Safe transactions at the exact proposal nonce', async () => {
    const safeAddress = '0x1111111111111111111111111111111111111111';
    const getMultisigTransactions = vi.fn().mockResolvedValue({
      results: [
        { ...pending, safeTxHash: '0xown', nonce: 4, isExecuted: true },
        { ...pending, safeTxHash: '0xpending', nonce: 4, isExecuted: false },
        { ...pending, safeTxHash: '0xother', nonce: 5, isExecuted: true },
      ],
    });

    await expect(
      executedSafeTransactionsAtNonce({ getMultisigTransactions } as never, safeAddress, '4'),
    ).resolves.toEqual([
      expect.objectContaining({ safeTxHash: '0xown', nonce: 4, isExecuted: true }),
    ]);
    expect(getMultisigTransactions).toHaveBeenCalledWith(safeAddress, {
      executed: true,
      nonce: '4',
      limit: 100,
    });

    await expect(
      safeTransactionsAtNonce({ getMultisigTransactions } as never, safeAddress, '4'),
    ).resolves.toEqual([
      expect.objectContaining({ safeTxHash: '0xown', nonce: 4 }),
      expect.objectContaining({ safeTxHash: '0xpending', nonce: 4 }),
    ]);
    expect(getMultisigTransactions).toHaveBeenLastCalledWith(safeAddress, {
      nonce: '4',
      limit: 100,
    });

    getMultisigTransactions.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(
      executedSafeTransactionsAtNonce({ getMultisigTransactions } as never, safeAddress, '4'),
    ).resolves.toEqual([]);
    getMultisigTransactions.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(
      safeTransactionsAtNonce({ getMultisigTransactions } as never, safeAddress, '4'),
    ).resolves.toBeNull();
  });

  it('never overwrites a proposal that already reached a terminal state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const failPayout = vi.fn();
    const transaction = {
      safePayoutProposal: { updateMany },
      payout: { updateMany: failPayout },
    } as unknown as Parameters<typeof applyPendingSafeProposalUpdate>[0];

    await expect(
      applyPendingSafeProposalUpdate(
        transaction,
        'proposal-id',
        'payout-id',
        { status: SafePayoutProposalStatus.STALE },
        true,
      ),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal-id',
          status: {
            in: [
              SafePayoutProposalStatus.SUBMITTING,
              SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
              SafePayoutProposalStatus.READY_TO_EXECUTE,
            ],
          },
        }),
      }),
    );
    expect(failPayout).not.toHaveBeenCalled();
  });

  it('fails only a payout that is still proposed after a terminal Safe transition', async () => {
    const failPayout = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      safePayoutProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      payout: { updateMany: failPayout },
    } as unknown as Parameters<typeof applyPendingSafeProposalUpdate>[0];

    await expect(
      applyPendingSafeProposalUpdate(
        transaction,
        'proposal-id',
        'payout-id',
        { status: SafePayoutProposalStatus.FAILED },
        true,
      ),
    ).resolves.toBe(true);
    expect(failPayout).toHaveBeenCalledWith({
      where: { id: 'payout-id', status: PayoutStatus.PROPOSED },
      data: { status: PayoutStatus.FAILED },
    });
  });

  it('replaces an unmatched confirmed projection with the durable Safe payout', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'projection-id',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      executedAt: now,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const removeProjection = vi.fn().mockResolvedValue({});
    const transaction = {
      safePayoutProposal: { updateMany: vi.fn() },
      payout: { findFirst, updateMany, delete: removeProjection },
    } as unknown as Parameters<typeof reconcileConfirmedSafePayout>[0];

    await expect(
      reconcileConfirmedSafePayout(
        transaction,
        {
          id: 'payout-id',
          goalId: 'goal-id',
          asset: FundingAsset.PRE,
          kind: PayoutKind.EXPENSE,
          amountRaw: '100',
          recipientAddress: '0x1111111111111111111111111111111111111111',
        },
        '0xABCDEF',
      ),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chainTxHash: '0xabcdef',
          safeIntent: { is: null },
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payout-id', status: PayoutStatus.PROPOSED },
      data: {
        status: PayoutStatus.EXECUTED,
        chainTxHash: '0xabcdef',
        recipientAddress: '0x1111111111111111111111111111111111111111',
        executedAt: now,
      },
    });
    expect(removeProjection).toHaveBeenCalledWith({ where: { id: 'projection-id' } });
  });

  it('recovers an old missing submission even when the Safe nonce did not advance', () => {
    const proposal = {
      status: SafePayoutProposalStatus.SUBMITTING,
      safeNonce: '4',
      createdAt: new Date(now.getTime() - SAFE_SUBMITTING_RECOVERY_DELAY_MS),
    };

    expect(shouldRecoverMissingSafeSubmission(proposal, 5n, { statusCode: 404 }, now)).toBe(true);
    expect(shouldRecoverMissingSafeSubmission(proposal, 4n, { statusCode: 404 }, now)).toBe(true);
    expect(shouldRecoverMissingSafeSubmission(proposal, 5n, { statusCode: 503 }, now)).toBe(false);
    expect(
      shouldRecoverMissingSafeSubmission(
        { ...proposal, createdAt: new Date(now.getTime() - 1_000) },
        5n,
        { statusCode: 404 },
        now,
      ),
    ).toBe(false);
    expect(classifyMissingSafeSubmission('4', 4n)).toMatchObject({
      status: SafePayoutProposalStatus.FAILED,
    });
    expect(classifyMissingSafeSubmission('4', 5n)).toMatchObject({
      status: SafePayoutProposalStatus.SUBMITTING,
      failureReason: 'Safe nonce advanced; awaiting verified execution or replacement',
    });
    expect(classifyMissingSafeSubmission('4', 5n, true)).toMatchObject({
      status: SafePayoutProposalStatus.STALE,
    });
  });
});
