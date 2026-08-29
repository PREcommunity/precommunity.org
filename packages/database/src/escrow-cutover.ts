import {
  ExpenseStatus,
  FundingAsset,
  FundingGoalStatus,
  MetadataStatus,
  PayoutStatus,
  SafeGoalActionProposalStatus,
  SafeGoalManagerProposalStatus,
  SafePayoutProposalStatus,
  type Prisma,
} from './generated/prisma/client';

const activePayoutProposalStatuses = [
  SafePayoutProposalStatus.SUBMITTING,
  SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
  SafePayoutProposalStatus.READY_TO_EXECUTE,
];
const activeGoalManagerProposalStatuses = [
  SafeGoalManagerProposalStatus.SUBMITTING,
  SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalManagerProposalStatus.READY_TO_EXECUTE,
];
const activeGoalActionProposalStatuses = [
  SafeGoalActionProposalStatus.SUBMITTING,
  SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalActionProposalStatus.READY_TO_EXECUTE,
];

type CutoverDatabase = Pick<
  Prisma.TransactionClient,
  | 'auditEvent'
  | 'chainAuthority'
  | 'chainEvent'
  | 'cryptoContribution'
  | 'expense'
  | 'fundingGoal'
  | 'fundingGoalPeriod'
  | 'goalManagerAssignment'
  | 'indexerState'
  | 'payout'
  | 'safeGoalActionIntent'
  | 'safeGoalActionProposal'
  | 'safeGoalManagerIntent'
  | 'safeGoalManagerProposal'
  | 'safePayoutIntent'
  | 'safePayoutProposal'
  | 'sponsorProfile'
>;

export type EscrowCutoverNetwork = 'base' | 'base-sepolia';

export function escrowCutoverDeploymentEnvKeys(network: EscrowCutoverNetwork) {
  return network === 'base'
    ? {
        escrowAddress: 'PUBLIC_ESCROW_ADDRESS',
        escrowDeploymentBlock: 'PUBLIC_ESCROW_DEPLOYMENT_BLOCK',
        preAddress: 'PUBLIC_PRE_ADDRESS',
        usdcAddress: 'PUBLIC_USDC_ADDRESS',
        initialOwnerAddress: 'PUBLIC_INITIAL_OWNER_ADDRESS',
        treasuryAddress: 'PUBLIC_TREASURY_ADDRESS',
      }
    : {
        escrowAddress: 'ESCROW_ADDRESS_TESTNET',
        escrowDeploymentBlock: 'ESCROW_DEPLOYMENT_BLOCK_TESTNET',
        preAddress: 'PRE_ADDRESS_TESTNET',
        usdcAddress: 'USDC_ADDRESS_TESTNET',
        initialOwnerAddress: 'INITIAL_OWNER_ADDRESS_TESTNET',
        treasuryAddress: 'TREASURY_ADDRESS_TESTNET',
      };
}

export async function escrowCutoverBlockers(database: CutoverDatabase, chainId: number) {
  const [
    indexedGoals,
    openGoals,
    proposedPayouts,
    activePayoutProposals,
    activeGoalManagerProposals,
    activeGoalActionProposals,
    unsubmittedGoalManagerIntents,
    unsubmittedGoalActionIntents,
    contributions,
    executedPayouts,
  ] = await Promise.all([
    database.fundingGoal.count({ where: { chainId } }),
    database.fundingGoal.count({
      where: {
        chainId,
        status: FundingGoalStatus.OPEN,
      },
    }),
    database.payout.count({
      where: { status: PayoutStatus.PROPOSED, goal: { chainId } },
    }),
    database.safePayoutProposal.count({
      where: {
        status: { in: activePayoutProposalStatuses },
        intent: { chainId },
      },
    }),
    database.safeGoalManagerProposal.count({
      where: {
        status: { in: activeGoalManagerProposalStatuses },
        intent: { chainId },
      },
    }),
    database.safeGoalActionProposal.count({
      where: {
        status: { in: activeGoalActionProposalStatuses },
        intent: { chainId },
      },
    }),
    database.safeGoalManagerIntent.count({
      where: { chainId, consumedAt: null, proposal: { is: null } },
    }),
    database.safeGoalActionIntent.count({
      where: { chainId, consumedAt: null, proposal: { is: null } },
    }),
    database.cryptoContribution.findMany({
      where: { chainId },
      select: { asset: true, amountRaw: true },
    }),
    database.payout.findMany({
      where: { status: PayoutStatus.EXECUTED, goal: { chainId } },
      select: { asset: true, amountRaw: true },
    }),
  ]);

  const projectedLiability = (asset: FundingAsset) =>
    contributions
      .filter((item) => item.asset === asset)
      .reduce((total, item) => total + BigInt(item.amountRaw), 0n) -
    executedPayouts
      .filter((item) => item.asset === asset)
      .reduce((total, item) => total + BigInt(item.amountRaw), 0n);

  return {
    indexedGoals,
    openGoals,
    proposedPayouts,
    activePayoutProposals,
    activeGoalManagerProposals,
    activeGoalActionProposals,
    unsubmittedGoalManagerIntents,
    unsubmittedGoalActionIntents,
    projectedPreLiabilityRaw: projectedLiability(FundingAsset.PRE).toString(),
    projectedUsdcLiabilityRaw: projectedLiability(FundingAsset.USDC).toString(),
  };
}

export function hasEscrowCutoverBlockers(
  blockers: Awaited<ReturnType<typeof escrowCutoverBlockers>>,
) {
  return Object.values(blockers).some((value) => BigInt(value) !== 0n);
}

/**
 * Deletes only deployment-specific escrow state. Community content, users, drafts and the
 * immutable audit trail remain. Callers must stop writers and run escrowCutoverBlockers first.
 */
export async function resetForEscrowCutover(
  database: CutoverDatabase,
  input: {
    chainId: number;
    newEscrowAddress: string;
    newDeploymentBlock: string;
  },
) {
  const goals = await database.fundingGoal.findMany({
    where: { chainId: input.chainId },
    select: { id: true, expenseId: true },
  });
  const expenseIds = [
    ...new Set(goals.flatMap((goal) => (goal.expenseId ? [goal.expenseId] : []))),
  ];

  const safeGoalActionProposals = await database.safeGoalActionProposal.deleteMany({
    where: { intent: { chainId: input.chainId } },
  });
  const safeGoalActionIntents = await database.safeGoalActionIntent.deleteMany({
    where: { chainId: input.chainId },
  });
  const safePayoutProposals = await database.safePayoutProposal.deleteMany({
    where: { intent: { chainId: input.chainId } },
  });
  const safePayoutIntents = await database.safePayoutIntent.deleteMany({
    where: { chainId: input.chainId },
  });
  const safeGoalManagerProposals = await database.safeGoalManagerProposal.deleteMany({
    where: { intent: { chainId: input.chainId } },
  });
  const safeGoalManagerIntents = await database.safeGoalManagerIntent.deleteMany({
    where: { chainId: input.chainId },
  });
  const managerAssignments = await database.goalManagerAssignment.deleteMany({
    where: { chainId: input.chainId },
  });

  const payouts = await database.payout.deleteMany({
    where: { goal: { chainId: input.chainId } },
  });
  const periods = await database.fundingGoalPeriod.deleteMany({
    where: { goal: { chainId: input.chainId } },
  });
  const contributions = await database.cryptoContribution.deleteMany({
    where: { chainId: input.chainId },
  });
  const fundingGoals = await database.fundingGoal.deleteMany({
    where: { chainId: input.chainId },
  });
  const drafts = expenseIds.length
    ? await database.expense.updateMany({
        where: { id: { in: expenseIds }, status: { not: ExpenseStatus.ARCHIVED } },
        data: {
          status: ExpenseStatus.DRAFT,
          pendingChainGoalId: null,
          pendingChainTxHash: null,
          activeFrom: null,
          activeUntil: null,
        },
      })
    : { count: 0 };
  const profiles = await database.sponsorProfile.updateMany({
    where: { chainId: input.chainId },
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
    where: { chainId: input.chainId },
  });
  const events = await database.chainEvent.deleteMany({ where: { chainId: input.chainId } });
  const states = await database.indexerState.deleteMany({ where: { chainId: input.chainId } });

  const reset = {
    fundingGoals: fundingGoals.count,
    drafts: drafts.count,
    contributions: contributions.count,
    payouts: payouts.count,
    periods: periods.count,
    profiles: profiles.count,
    authorities: authorities.count,
    events: events.count,
    states: states.count,
    safePayoutIntents: safePayoutIntents.count,
    safePayoutProposals: safePayoutProposals.count,
    safeGoalActionIntents: safeGoalActionIntents.count,
    safeGoalActionProposals: safeGoalActionProposals.count,
    safeGoalManagerIntents: safeGoalManagerIntents.count,
    safeGoalManagerProposals: safeGoalManagerProposals.count,
    managerAssignments: managerAssignments.count,
  };
  await database.auditEvent.create({
    data: {
      actorAddress: null,
      entityType: 'EscrowDeployment',
      entityId: input.newEscrowAddress.toLowerCase(),
      action: 'ESCROW_GUARDED_CUTOVER_RESET',
      after: {
        chainId: input.chainId,
        deploymentBlock: input.newDeploymentBlock,
        reset,
      },
    },
  });
  return reset;
}
