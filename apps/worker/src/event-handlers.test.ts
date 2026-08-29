import {
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MonthlySurplusPolicy,
  PayoutKind,
  PayoutStatus,
  SafeGoalActionProposalStatus,
} from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { handleDecodedEscrowEvent } from './event-handlers';

const goalId = `0x${'11'.repeat(32)}`;
const executionTxHash = `0x${'22'.repeat(32)}` as const;
const recipientAddress = '0x1111111111111111111111111111111111111111';

function payoutEvent() {
  return {
    eventName: 'ExpenseReleased',
    args: {
      goalId,
      token: config.deployment.preAddress,
      amount: 100n,
      payoutRecipient: recipientAddress,
    },
    blockNumber: 123n,
    blockHash: `0x${'33'.repeat(32)}`,
    blockTimestamp: 1_776_422_400n,
    txHash: executionTxHash,
    logIndex: 4,
  };
}

function proposedPayout(id: string, proposalId: string, proposalTxHash: string | null) {
  return {
    id,
    goalId: 'goal-row-id',
    asset: FundingAsset.PRE,
    kind: PayoutKind.EXPENSE,
    amountRaw: '100',
    recipientAddress,
    status: PayoutStatus.PROPOSED,
    createdAt: new Date('2026-08-15T09:00:00.000Z'),
    safeIntent: {
      proposal: {
        id: proposalId,
        threshold: 2,
        executionTxHash: proposalTxHash,
      },
    },
  };
}

describe('escrow event projection', () => {
  it('scopes goal creation and lookup to the configured chain', async () => {
    const fundingGoal = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'goal-row-id' }),
    };
    const database = {
      expense: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      fundingGoal,
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'GoalCreated',
      args: {
        goalId,
        title: 'Public nodes',
        description: 'Infrastructure',
        recipient: recipientAddress,
        deadline: 1_893_456_000n,
        metadataURI: '',
        preTarget: 100n,
        usdcTarget: 0n,
      },
      blockNumber: 123n,
      blockHash: `0x${'33'.repeat(32)}`,
      blockTimestamp: 1_776_422_400n,
      txHash: executionTxHash,
      logIndex: 1,
    });

    expect(fundingGoal.findUnique).toHaveBeenCalledWith({
      where: {
        chainId_slug: {
          chainId: config.deployment.chainId,
          slug: 'public-nodes-11111111',
        },
      },
    });
    expect(fundingGoal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chainId_chainGoalId: {
            chainId: config.deployment.chainId,
            chainGoalId: goalId,
          },
        },
      }),
    );
  });

  it('stores the full recipient entitlement when a goal is closed', async () => {
    const update = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({ id: 'goal-row-id' }),
        update,
      },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'GoalClosed',
      args: {
        goalId,
        preRecipientEntitlement: 700n,
        usdcRecipientEntitlement: 250n,
      },
      blockNumber: 123n,
      blockHash: `0x${'33'.repeat(32)}`,
      blockTimestamp: 1_776_422_400n,
      txHash: executionTxHash,
      logIndex: 2,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: {
        status: 'CLOSED',
        closedAt: new Date(1_776_422_400_000),
        preRecipientEntitlementRaw: '700',
        usdcRecipientEntitlementRaw: '250',
      },
    });
  });

  it('switches GoalCreated to monthly and opens the first UTC period', async () => {
    const goalUpdate = vi.fn().mockResolvedValue({});
    const periodUpsert = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({ id: 'goal-row-id' }),
        update: goalUpdate,
      },
      fundingGoalPeriod: { upsert: periodUpsert },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlyGoalCreated',
      args: {
        goalId,
        periodStart: BigInt(Date.UTC(2028, 0, 31, 12, 34) / 1000),
        periodEnd: BigInt(Date.UTC(2028, 1, 29) / 1000),
        settlementDay: 31,
        surplusPolicy: 1,
      },
      blockNumber: 123n,
      blockHash: `0x${'33'.repeat(32)}`,
      blockTimestamp: BigInt(Date.UTC(2028, 0, 31, 12, 34) / 1000),
      txHash: executionTxHash,
      logIndex: 2,
    });

    expect(goalUpdate).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: expect.objectContaining({
        goalType: FundingGoalType.MONTHLY,
        monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
        monthlyFirstSettlementAt: new Date('2028-02-29T00:00:00.000Z'),
        monthlySettlementDay: 31,
        monthStart: new Date('2028-01-31T12:34:00.000Z'),
        deadline: new Date('2028-02-29T00:00:00.000Z'),
      }),
    });
    expect(periodUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { goalId_periodIndex: { goalId: 'goal-row-id', periodIndex: 1 } },
        create: expect.objectContaining({
          periodIndex: 1,
          startsAt: new Date('2028-01-31T12:34:00.000Z'),
          endsAt: new Date('2028-02-29T00:00:00.000Z'),
          surplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
        }),
      }),
    );
  });

  it('rejects a monthly creation event with an invalid settlement day', async () => {
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({ id: 'goal-row-id' }),
        update: vi.fn(),
      },
      fundingGoalPeriod: { upsert: vi.fn() },
    } as never;

    await expect(
      handleDecodedEscrowEvent(database, {
        eventName: 'MonthlyGoalCreated',
        args: {
          goalId,
          periodStart: BigInt(Date.UTC(2028, 0, 31, 12, 34) / 1000),
          periodEnd: BigInt(Date.UTC(2028, 1, 29) / 1000),
          settlementDay: 0,
          surplusPolicy: 1,
        },
        blockNumber: 123n,
        blockHash: `0x${'33'.repeat(32)}`,
        blockTimestamp: BigInt(Date.UTC(2028, 0, 31, 12, 34) / 1000),
        txHash: executionTxHash,
        logIndex: 2,
      }),
    ).rejects.toThrow('Unsupported monthly settlement day');
  });

  it('settles a monthly period with proof and opens the next calendar period', async () => {
    const goalUpdate = vi.fn().mockResolvedValue({});
    const periodUpsert = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.MONTHLY,
          monthlyPeriodsSettled: 0,
          monthlySettlementDay: 31,
        }),
        update: goalUpdate,
      },
      fundingGoalPeriod: { upsert: periodUpsert },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlyPeriodSettled',
      args: {
        goalId,
        periodIndex: 1,
        periodStart: BigInt(Date.UTC(2028, 0, 31, 12, 34) / 1000),
        periodEnd: BigInt(Date.UTC(2028, 1, 29) / 1000),
        surplusPolicy: 0,
        finalPeriod: false,
      },
      blockNumber: 500n,
      blockHash: `0x${'55'.repeat(32)}`,
      blockTimestamp: BigInt(Date.UTC(2028, 1, 29, 0, 1) / 1000),
      txHash: executionTxHash,
      logIndex: 8,
    });

    expect(periodUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: expect.objectContaining({
          settlementBlock: 500n,
          settlementLogIndex: 8,
          finalPeriod: false,
        }),
      }),
    );
    expect(periodUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          periodIndex: 2,
          startsAt: new Date('2028-02-29T00:00:00.000Z'),
          endsAt: new Date('2028-03-31T00:00:00.000Z'),
        }),
      }),
    );
    expect(goalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          monthlyPeriodsSettled: 1,
          deadline: new Date('2028-03-31T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('refuses to project a next period when the monthly anchor is missing', async () => {
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.MONTHLY,
          monthlyPeriodsSettled: 0,
          monthlySettlementDay: null,
        }),
      },
    } as never;

    await expect(
      handleDecodedEscrowEvent(database, {
        eventName: 'MonthlyPeriodSettled',
        args: {
          goalId,
          periodIndex: 1,
          periodStart: BigInt(Date.UTC(2028, 0, 31) / 1000),
          periodEnd: BigInt(Date.UTC(2028, 1, 29) / 1000),
          surplusPolicy: 0,
          finalPeriod: false,
        },
        blockNumber: 500n,
        blockHash: `0x${'55'.repeat(32)}`,
        blockTimestamp: BigInt(Date.UTC(2028, 1, 29, 0, 1) / 1000),
        txHash: executionTxHash,
        logIndex: 8,
      }),
    ).rejects.toThrow('has no valid settlement day');
  });

  it('projects exact monthly token accounting into period and lifetime entitlement', async () => {
    const periodUpdate = vi.fn().mockResolvedValue({});
    const nextPeriodUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const goalUpdate = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.MONTHLY,
          preRecipientEntitlementRaw: '700',
          usdcRecipientEntitlementRaw: '0',
        }),
        update: goalUpdate,
      },
      fundingGoalPeriod: { update: periodUpdate, updateMany: nextPeriodUpdate },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlyTokenSettled',
      args: {
        goalId,
        periodIndex: 2,
        token: config.deployment.preAddress,
        periodContributed: 500n,
        carryIn: 200n,
        recipientEntitlementAdded: 600n,
        carryOut: 100n,
      },
      blockNumber: 501n,
      blockHash: `0x${'66'.repeat(32)}`,
      blockTimestamp: 1_800_000_000n,
      txHash: executionTxHash,
      logIndex: 9,
    });

    expect(periodUpdate).toHaveBeenCalledWith({
      where: { goalId_periodIndex: { goalId: 'goal-row-id', periodIndex: 2 } },
      data: {
        preContributedRaw: '500',
        preCarryInRaw: '200',
        preRecipientEntitlementAddedRaw: '600',
        preCarryOutRaw: '100',
      },
    });
    expect(nextPeriodUpdate).toHaveBeenCalledWith({
      where: { goalId: 'goal-row-id', periodIndex: 3, settledAt: null },
      data: { preCarryInRaw: '100' },
    });
    expect(goalUpdate).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: { preCarryRaw: '100', preRecipientEntitlementRaw: '1300' },
    });
  });

  it('updates the open period policy and confirms only the matching Safe action', async () => {
    const proposalUpdate = vi.fn().mockResolvedValue({});
    const goalUpdate = vi.fn().mockResolvedValue({});
    const periodUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.MONTHLY,
          monthlyPeriodsSettled: 3,
        }),
        update: goalUpdate,
      },
      fundingGoalPeriod: { updateMany: periodUpdate },
      safeGoalActionProposal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rollover-proposal',
            threshold: 2,
            executionTxHash: null,
            intent: { parameters: { targetPolicy: MonthlySurplusPolicy.ROLL_OVER } },
          },
          {
            id: 'payout-all-proposal',
            threshold: 3,
            executionTxHash: executionTxHash.toUpperCase(),
            intent: { parameters: { targetPolicy: MonthlySurplusPolicy.PAYOUT_ALL } },
          },
        ]),
        update: proposalUpdate,
      },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlySurplusPolicyUpdated',
      args: { goalId, previousPolicy: 1, newPolicy: 0 },
      blockNumber: 502n,
      blockHash: `0x${'77'.repeat(32)}`,
      blockTimestamp: 1_800_000_100n,
      txHash: executionTxHash,
      logIndex: 10,
    });

    expect(goalUpdate).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: { monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL },
    });
    expect(periodUpdate).toHaveBeenCalledWith({
      where: { goalId: 'goal-row-id', periodIndex: 4, settledAt: null },
      data: { surplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL },
    });
    expect(proposalUpdate).toHaveBeenCalledWith({
      where: { id: 'payout-all-proposal' },
      data: expect.objectContaining({
        status: SafeGoalActionProposalStatus.EXECUTED,
        confirmations: 3,
        executionTxHash,
      }),
    });
  });

  it('projects exact monthly cancellation entitlements and confirms the Safe emergency action', async () => {
    const goalUpdate = vi.fn().mockResolvedValue({});
    const proposalUpdate = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.MONTHLY,
          preTreasuryEntitlementRaw: '50',
          usdcTreasuryEntitlementRaw: '75',
        }),
        update: goalUpdate,
      },
      safeGoalActionProposal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cancel-proposal',
            threshold: 2,
            executionTxHash,
            intent: { parameters: null },
          },
        ]),
        update: proposalUpdate,
      },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlyGoalCancelled',
      args: {
        goalId,
        preTreasuryEntitlementAdded: 400n,
        usdcTreasuryEntitlementAdded: 125n,
      },
      blockNumber: 503n,
      blockHash: `0x${'88'.repeat(32)}`,
      blockTimestamp: 1_800_000_200n,
      txHash: executionTxHash,
      logIndex: 12,
    });

    expect(goalUpdate).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: {
        preTreasuryEntitlementRaw: '450',
        usdcTreasuryEntitlementRaw: '200',
        preCarryRaw: '0',
        usdcCarryRaw: '0',
      },
    });
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cancel-proposal' },
        data: expect.objectContaining({ status: SafeGoalActionProposalStatus.EXECUTED }),
      }),
    );
  });

  it('records a graceful stop request and confirms its matching lifecycle proposal', async () => {
    const goalUpdate = vi.fn().mockResolvedValue({});
    const proposalUpdate = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'goal-row-id', goalType: FundingGoalType.MONTHLY }),
        update: goalUpdate,
      },
      safeGoalActionProposal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'stop-proposal',
            threshold: 2,
            executionTxHash,
            intent: { parameters: null },
          },
        ]),
        update: proposalUpdate,
      },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'MonthlyGoalStopRequested',
      args: { goalId, periodEnd: 1_800_100_000n },
      blockNumber: 504n,
      blockHash: `0x${'aa'.repeat(32)}`,
      blockTimestamp: 1_800_000_250n,
      txHash: executionTxHash,
      logIndex: 10,
    });

    expect(goalUpdate).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: { monthlyStopRequestedAt: new Date(1_800_000_250_000) },
    });
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stop-proposal' },
        data: expect.objectContaining({ status: SafeGoalActionProposalStatus.EXECUTED }),
      }),
    );
  });

  it('routes every one-time contribution to treasury after cancellation', async () => {
    const update = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-row-id',
          goalType: FundingGoalType.ONE_TIME,
        }),
        update,
      },
      cryptoContribution: {
        findMany: vi.fn().mockResolvedValue([
          { asset: FundingAsset.PRE, amountRaw: '10' },
          { asset: FundingAsset.PRE, amountRaw: '15' },
          { asset: FundingAsset.USDC, amountRaw: '20' },
        ]),
      },
    } as never;

    await handleDecodedEscrowEvent(database, {
      eventName: 'GoalCancelled',
      args: { goalId },
      blockNumber: 504n,
      blockHash: `0x${'99'.repeat(32)}`,
      blockTimestamp: 1_800_000_300n,
      txHash: executionTxHash,
      logIndex: 11,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'goal-row-id' },
      data: {
        status: FundingGoalStatus.CANCELLED,
        closedAt: new Date(1_800_000_300_000),
        preTreasuryEntitlementRaw: '25',
        usdcTreasuryEntitlementRaw: '20',
      },
    });
  });

  it('skips a malformed profile without touching the profile projection', async () => {
    const userUpsert = vi.fn();
    const profileUpsert = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = {
      user: { upsert: userUpsert },
      sponsorProfile: { upsert: profileUpsert },
    } as never;

    try {
      await expect(
        handleDecodedEscrowEvent(database, {
          eventName: 'ProfileUpdated',
          args: {
            account: recipientAddress,
            revision: 1n,
            displayName: 'Broken \uFFFD profile',
            websiteUrl: '',
            bio: '',
            avatarURI: '',
            defaultPublic: true,
          },
          blockNumber: 123n,
          blockHash: `0x${'33'.repeat(32)}`,
          blockTimestamp: 1_776_422_400n,
          txHash: executionTxHash,
          logIndex: 3,
        }),
      ).resolves.toBeNull();
    } finally {
      warning.mockRestore();
    }

    expect(userUpsert).not.toHaveBeenCalled();
    expect(profileUpsert).not.toHaveBeenCalled();
  });

  it('matches a payout to the proposal with the exact execution transaction hash', async () => {
    const first = proposedPayout('payout-1', 'proposal-1', `0x${'44'.repeat(32)}`);
    const executed = proposedPayout('payout-2', 'proposal-2', executionTxHash.toUpperCase());
    const payoutUpdate = vi.fn().mockResolvedValue({});
    const proposalUpdate = vi.fn().mockResolvedValue({});
    const payoutCreate = vi.fn();
    const database = {
      fundingGoal: { findUnique: vi.fn().mockResolvedValue({ id: 'goal-row-id' }) },
      payout: {
        findMany: vi.fn().mockResolvedValue([first, executed]),
        update: payoutUpdate,
        create: payoutCreate,
      },
      safePayoutProposal: { update: proposalUpdate },
    } as never;

    await handleDecodedEscrowEvent(database, payoutEvent());

    expect(payoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: executed.id } }),
    );
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'proposal-2' } }),
    );
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('does not guess between multiple indistinguishable Safe proposals', async () => {
    const payoutUpdate = vi.fn();
    const proposalUpdate = vi.fn();
    const payoutCreate = vi.fn().mockResolvedValue({});
    const database = {
      fundingGoal: { findUnique: vi.fn().mockResolvedValue({ id: 'goal-row-id' }) },
      payout: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            proposedPayout('payout-1', 'proposal-1', null),
            proposedPayout('payout-2', 'proposal-2', null),
          ]),
        update: payoutUpdate,
        create: payoutCreate,
      },
      safePayoutProposal: { update: proposalUpdate },
    } as never;

    await handleDecodedEscrowEvent(database, payoutEvent());

    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(proposalUpdate).not.toHaveBeenCalled();
    expect(payoutCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goalId: 'goal-row-id',
        chainTxHash: executionTxHash,
        status: PayoutStatus.EXECUTED,
      }),
    });
  });
});
