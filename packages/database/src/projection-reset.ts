import {
  ExpenseStatus,
  FundingGoalStatus,
  FundingGoalType,
  MetadataStatus,
  PayoutStatus,
  Prisma,
  SafePayoutProposalStatus,
  SafeGoalActionProposalStatus,
} from './generated/prisma/client';

type ProjectionResetDatabase = Pick<
  Prisma.TransactionClient,
  | 'chainAuthority'
  | 'chainEvent'
  | 'cryptoContribution'
  | 'expense'
  | 'fundingGoal'
  | 'fundingGoalPeriod'
  | 'indexerState'
  | 'payout'
  | 'safePayoutProposal'
  | 'safeGoalActionProposal'
  | 'sponsorProfile'
>;

interface ProjectionResetOptions {
  chainId: number;
  contractAddress?: string;
}

/**
 * Clears rebuildable chain data while retaining Safe intents and proposals,
 * which are durable Transaction Service state rather than chain projections.
 */
export async function resetChainProjection(
  database: ProjectionResetDatabase,
  { chainId, contractAddress }: ProjectionResetOptions,
) {
  const goals = await database.fundingGoal.findMany({
    where: { chainId, creationTxHash: { not: null } },
    select: {
      id: true,
      expenseId: true,
      _count: { select: { safePayoutIntents: true, safeGoalActionIntents: true } },
    },
  });
  const retainedGoalIds = goals
    .filter((goal) => goal._count.safePayoutIntents > 0 || goal._count.safeGoalActionIntents > 0)
    .map((goal) => goal.id);
  const expenseIds = goals.flatMap((goal) => (goal.expenseId ? [goal.expenseId] : []));

  const expenses = expenseIds.length
    ? await database.expense.updateMany({
        where: { id: { in: expenseIds }, status: ExpenseStatus.PUBLISHED },
        data: { status: ExpenseStatus.PENDING_CHAIN, pendingChainTxHash: null },
      })
    : { count: 0 };

  let contributions = { count: 0 };
  let payouts = { count: 0 };
  let resetSafePayouts = { count: 0 };
  let resetSafeProposals = { count: 0 };
  let periods = { count: 0 };
  let resetSafeGoalActions = { count: 0 };
  if (retainedGoalIds.length) {
    periods = await database.fundingGoalPeriod.deleteMany({
      where: { goalId: { in: retainedGoalIds } },
    });
    contributions = await database.cryptoContribution.deleteMany({
      where: { goalId: { in: retainedGoalIds } },
    });
    payouts = await database.payout.deleteMany({
      where: { goalId: { in: retainedGoalIds }, safeIntent: null },
    });
    resetSafeProposals = await database.safePayoutProposal.updateMany({
      where: {
        status: SafePayoutProposalStatus.EXECUTED,
        intent: {
          chainId,
          goalId: { in: retainedGoalIds },
          payout: { status: PayoutStatus.EXECUTED },
        },
      },
      data: {
        status: SafePayoutProposalStatus.SUBMITTING,
        executionTxHash: null,
        failureReason: null,
        lastCheckedAt: null,
        executedAt: null,
      },
    });
    resetSafePayouts = await database.payout.updateMany({
      where: {
        goalId: { in: retainedGoalIds },
        safeIntent: { isNot: null },
        status: PayoutStatus.EXECUTED,
      },
      data: { status: PayoutStatus.PROPOSED, chainTxHash: null, executedAt: null },
    });
    resetSafeGoalActions = await database.safeGoalActionProposal.updateMany({
      where: {
        status: SafeGoalActionProposalStatus.EXECUTED,
        intent: { chainId, goalId: { in: retainedGoalIds } },
      },
      data: {
        status: SafeGoalActionProposalStatus.SUBMITTING,
        executionTxHash: null,
        failureReason: null,
        lastCheckedAt: null,
        executedAt: null,
      },
    });
    await database.fundingGoal.updateMany({
      where: { id: { in: retainedGoalIds } },
      data: {
        status: FundingGoalStatus.OPEN,
        creatorAddress: '0x0000000000000000000000000000000000000000',
        goalType: FundingGoalType.ONE_TIME,
        monthlySurplusPolicy: null,
        monthlyFirstSettlementAt: null,
        monthlySettlementDay: null,
        monthlyStopRequestedAt: null,
        monthlyPeriodsSettled: 0,
        preRecipientEntitlementRaw: '0',
        usdcRecipientEntitlementRaw: '0',
        preCarryRaw: '0',
        usdcCarryRaw: '0',
        preTreasuryEntitlementRaw: '0',
        usdcTreasuryEntitlementRaw: '0',
        creationTxHash: null,
        creationBlock: null,
        creationBlockHash: null,
        publishedAt: null,
        closedAt: null,
        metadataStatus: MetadataStatus.NOT_SET,
        metadata: Prisma.DbNull,
      },
    });
  }

  const fundingGoals = await database.fundingGoal.deleteMany({
    where: {
      chainId,
      creationTxHash: { not: null },
      ...(retainedGoalIds.length ? { id: { notIn: retainedGoalIds } } : {}),
    },
  });
  const profiles = await database.sponsorProfile.updateMany({
    where: { chainId },
    data: {
      active: false,
      revision: 0n,
      displayName: null,
      websiteUrl: null,
      bio: null,
      avatarUri: null,
      avatarStatus: MetadataStatus.NOT_SET,
      defaultPublic: false,
      blockNumber: null,
      blockHash: null,
      txHash: null,
      logIndex: null,
    },
  });
  const authorities = await database.chainAuthority.deleteMany({
    where: { chainId, ...(contractAddress ? { contractAddress } : {}) },
  });
  const events = await database.chainEvent.deleteMany({ where: { chainId } });
  const states = await database.indexerState.deleteMany({ where: { chainId } });

  return {
    expenses: expenses.count,
    fundingGoals: fundingGoals.count,
    retainedFundingGoals: retainedGoalIds.length,
    contributions: contributions.count,
    payouts: payouts.count,
    resetSafePayouts: resetSafePayouts.count,
    resetSafeProposals: resetSafeProposals.count,
    periods: periods.count,
    resetSafeGoalActions: resetSafeGoalActions.count,
    profiles: profiles.count,
    authorities: authorities.count,
    events: events.count,
    states: states.count,
  };
}
