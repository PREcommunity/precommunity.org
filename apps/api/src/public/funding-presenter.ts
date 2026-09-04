import {
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MetadataStatus,
  PayoutKind,
  type Expense,
  type FundingGoal,
  type FundingGoalPeriod,
} from '@precommunity/database';
import {
  canonicalGoalMetadata,
  type AssetCode,
  type FundingProgress,
  type GoalMetadata,
  type GoalStatus,
} from '@precommunity/shared';
import { formatUnits, parseUnits } from 'viem';

const assetDecimals: Record<AssetCode, number> = { PRE: 18, USDC: 6 };

export function fundingProgress(
  asset: AssetCode,
  target: bigint,
  funded: bigint,
  released: bigint,
): FundingProgress {
  const decimals = assetDecimals[asset];
  const capped = funded < target ? funded : target;
  return {
    asset,
    target: formatUnits(target, decimals),
    funded: formatUnits(funded, decimals),
    released: formatUnits(released, decimals),
    surplus: formatUnits(funded > target ? funded - target : 0n, decimals),
    percent: target === 0n ? 0 : Number((capped * 100n + target / 2n) / target),
  };
}

export function totalFundingProgress(asset: AssetCode, lines: FundingProgress[]) {
  const decimals = assetDecimals[asset];
  const sum = (field: 'target' | 'funded' | 'released') =>
    lines.reduce((total, item) => total + parseUnits(item[field], decimals), 0n);
  return fundingProgress(asset, sum('target'), sum('funded'), sum('released'));
}

export function metadataFrom(value: unknown): GoalMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const metadata = value as Partial<GoalMetadata>;
  if (metadata.schema !== 'precommunity.goal-metadata.v1') return undefined;
  return canonicalGoalMetadata({
    category: metadata.category,
    subproject: metadata.subproject,
    discussionUrl: metadata.discussionUrl,
    documents: metadata.documents,
  });
}

export function mapPublicFundingGoal(
  goal: FundingGoal & {
    periods?: FundingGoalPeriod[];
    expense?: Pick<Expense, 'discussionUrl'> | null;
  },
  fundedByGoal: ReadonlyMap<string, bigint>,
  releasedByGoal: ReadonlyMap<string, bigint>,
  reservedByGoal: ReadonlyMap<string, bigint> = new Map(),
  now = Date.now(),
) {
  const preFunded = fundedByGoal.get(`${goal.id}:${FundingAsset.PRE}`) ?? 0n;
  const usdcFunded = fundedByGoal.get(`${goal.id}:${FundingAsset.USDC}`) ?? 0n;
  const released = (asset: FundingAsset, kind: PayoutKind) =>
    releasedByGoal.get(`${goal.id}:${asset}:${kind}`) ?? 0n;
  const reserved = (asset: FundingAsset, kind: PayoutKind) =>
    reservedByGoal.get(`${goal.id}:${asset}:${kind}`) ?? 0n;
  const preExpenseReleased = released(FundingAsset.PRE, PayoutKind.EXPENSE);
  const usdcExpenseReleased = released(FundingAsset.USDC, PayoutKind.EXPENSE);
  const preTreasuryReleased = released(FundingAsset.PRE, PayoutKind.CANCELLED_FUNDS);
  const usdcTreasuryReleased = released(FundingAsset.USDC, PayoutKind.CANCELLED_FUNDS);
  const preExpenseReserved = reserved(FundingAsset.PRE, PayoutKind.EXPENSE);
  const usdcExpenseReserved = reserved(FundingAsset.USDC, PayoutKind.EXPENSE);
  const preTreasuryReserved = reserved(FundingAsset.PRE, PayoutKind.CANCELLED_FUNDS);
  const usdcTreasuryReserved = reserved(FundingAsset.USDC, PayoutKind.CANCELLED_FUNDS);
  const metadata =
    goal.metadataStatus === MetadataStatus.AVAILABLE ? metadataFrom(goal.metadata) : undefined;
  const { discussionUrl } = canonicalGoalMetadata({
    discussionUrl: metadata?.discussionUrl ?? goal.expense?.discussionUrl ?? undefined,
  });
  let status = goal.status as GoalStatus;
  if (
    goal.goalType === FundingGoalType.ONE_TIME &&
    goal.status === FundingGoalStatus.OPEN &&
    goal.deadline.getTime() <= now
  ) {
    status = 'EXPIRED';
  }
  if (
    goal.status === FundingGoalStatus.CLOSED &&
    preExpenseReleased + usdcExpenseReleased ===
      BigInt(goal.preRecipientEntitlementRaw) + BigInt(goal.usdcRecipientEntitlementRaw)
  ) {
    status = 'SETTLED';
  }

  const selectedPeriod = goal.periods?.[0];
  const monthly =
    goal.goalType === FundingGoalType.MONTHLY &&
    selectedPeriod &&
    goal.monthlySurplusPolicy &&
    goal.monthlyFirstSettlementAt &&
    goal.monthlySettlementDay !== null
      ? {
          phase:
            goal.status === FundingGoalStatus.CANCELLED
              ? ('CANCELLED' as const)
              : goal.status === FundingGoalStatus.CLOSED ||
                  goal.status === FundingGoalStatus.SETTLED
                ? ('CLOSED' as const)
                : goal.deadline.getTime() <= now
                  ? ('SETTLEMENT_DUE' as const)
                  : goal.monthlyStopRequestedAt
                    ? ('STOPPING' as const)
                    : ('ACTIVE' as const),
          surplusPolicy: goal.monthlySurplusPolicy,
          firstSettlementAt: goal.monthlyFirstSettlementAt.toISOString(),
          settlementDay: goal.monthlySettlementDay,
          stopRequestedAt: goal.monthlyStopRequestedAt?.toISOString() ?? null,
          periodsSettled: goal.monthlyPeriodsSettled,
          selectedPeriod: {
            periodIndex: selectedPeriod.periodIndex,
            startsAt: selectedPeriod.startsAt.toISOString(),
            endsAt: selectedPeriod.endsAt.toISOString(),
            surplusPolicy: selectedPeriod.surplusPolicy,
            finalPeriod: selectedPeriod.finalPeriod,
            settledAt: selectedPeriod.settledAt?.toISOString() ?? null,
            settlementTxHash: selectedPeriod.settlementTxHash as `0x${string}` | null,
            settlementBlock: selectedPeriod.settlementBlock?.toString() ?? null,
            settlementBlockHash: selectedPeriod.settlementBlockHash as `0x${string}` | null,
            settlementLogIndex: selectedPeriod.settlementLogIndex,
            assets: [
              {
                asset: 'PRE' as const,
                target: formatUnits(BigInt(goal.preTargetRaw), 18),
                contributed: formatUnits(BigInt(selectedPeriod.preContributedRaw), 18),
                carryIn: formatUnits(BigInt(selectedPeriod.preCarryInRaw), 18),
                vested: formatUnits(BigInt(selectedPeriod.preRecipientEntitlementAddedRaw), 18),
                carryOut: formatUnits(BigInt(selectedPeriod.preCarryOutRaw), 18),
              },
              {
                asset: 'USDC' as const,
                target: formatUnits(BigInt(goal.usdcTargetRaw), 6),
                contributed: formatUnits(BigInt(selectedPeriod.usdcContributedRaw), 6),
                carryIn: formatUnits(BigInt(selectedPeriod.usdcCarryInRaw), 6),
                vested: formatUnits(BigInt(selectedPeriod.usdcRecipientEntitlementAddedRaw), 6),
                carryOut: formatUnits(BigInt(selectedPeriod.usdcCarryOutRaw), 6),
              },
            ].filter((item) => item.target !== '0'),
          },
          lifetime: [
            {
              asset: 'PRE' as const,
              contributions: formatUnits(preFunded, 18),
              beneficiaryEntitlement: formatUnits(BigInt(goal.preRecipientEntitlementRaw), 18),
              treasuryEntitlement: formatUnits(BigInt(goal.preTreasuryEntitlementRaw), 18),
              beneficiaryPayouts: formatUnits(preExpenseReleased, 18),
              treasuryPayouts: formatUnits(preTreasuryReleased, 18),
              beneficiaryAvailable: formatUnits(
                BigInt(goal.preRecipientEntitlementRaw) > preExpenseReleased + preExpenseReserved
                  ? BigInt(goal.preRecipientEntitlementRaw) -
                      preExpenseReleased -
                      preExpenseReserved
                  : 0n,
                18,
              ),
              treasuryAvailable: formatUnits(
                BigInt(goal.preTreasuryEntitlementRaw) > preTreasuryReleased + preTreasuryReserved
                  ? BigInt(goal.preTreasuryEntitlementRaw) -
                      preTreasuryReleased -
                      preTreasuryReserved
                  : 0n,
                18,
              ),
            },
            {
              asset: 'USDC' as const,
              contributions: formatUnits(usdcFunded, 6),
              beneficiaryEntitlement: formatUnits(BigInt(goal.usdcRecipientEntitlementRaw), 6),
              treasuryEntitlement: formatUnits(BigInt(goal.usdcTreasuryEntitlementRaw), 6),
              beneficiaryPayouts: formatUnits(usdcExpenseReleased, 6),
              treasuryPayouts: formatUnits(usdcTreasuryReleased, 6),
              beneficiaryAvailable: formatUnits(
                BigInt(goal.usdcRecipientEntitlementRaw) > usdcExpenseReleased + usdcExpenseReserved
                  ? BigInt(goal.usdcRecipientEntitlementRaw) -
                      usdcExpenseReleased -
                      usdcExpenseReserved
                  : 0n,
                6,
              ),
              treasuryAvailable: formatUnits(
                BigInt(goal.usdcTreasuryEntitlementRaw) >
                  usdcTreasuryReleased + usdcTreasuryReserved
                  ? BigInt(goal.usdcTreasuryEntitlementRaw) -
                      usdcTreasuryReleased -
                      usdcTreasuryReserved
                  : 0n,
                6,
              ),
            },
          ].filter(
            (item) =>
              item.contributions !== '0' ||
              item.beneficiaryEntitlement !== '0' ||
              item.treasuryEntitlement !== '0' ||
              (item.asset === 'PRE' ? goal.preTargetRaw !== '0' : goal.usdcTargetRaw !== '0'),
          ),
        }
      : undefined;
  const progress =
    selectedPeriod && goal.goalType === FundingGoalType.MONTHLY
      ? [
          fundingProgress(
            'PRE',
            BigInt(goal.preTargetRaw),
            BigInt(selectedPeriod.preContributedRaw) + BigInt(selectedPeriod.preCarryInRaw),
            BigInt(selectedPeriod.preRecipientEntitlementAddedRaw),
          ),
          fundingProgress(
            'USDC',
            BigInt(goal.usdcTargetRaw),
            BigInt(selectedPeriod.usdcContributedRaw) + BigInt(selectedPeriod.usdcCarryInRaw),
            BigInt(selectedPeriod.usdcRecipientEntitlementAddedRaw),
          ),
        ]
      : [
          fundingProgress('PRE', BigInt(goal.preTargetRaw), preFunded, preExpenseReleased),
          fundingProgress('USDC', BigInt(goal.usdcTargetRaw), usdcFunded, usdcExpenseReleased),
        ];

  return {
    id: goal.id,
    slug: goal.slug,
    title: goal.title,
    description: goal.description,
    category: metadata?.category,
    subproject: metadata?.subproject,
    goalId: goal.id,
    chainGoalId: goal.chainGoalId as `0x${string}`,
    recipientAddress: goal.recipientAddress as `0x${string}`,
    creatorAddress: goal.creatorAddress as `0x${string}`,
    goalType: goal.goalType,
    deadline:
      goal.goalType === FundingGoalType.MONTHLY && selectedPeriod
        ? selectedPeriod.endsAt.toISOString()
        : goal.deadline.toISOString(),
    creationTxHash: goal.creationTxHash as `0x${string}`,
    creationBlock: goal.creationBlock!.toString(),
    discussionUrl,
    metadataUri: goal.metadataUri ?? undefined,
    metadataStatus: goal.metadataStatus,
    documents: metadata?.documents ?? [],
    status,
    progress: progress.filter((item) => item.target !== '0'),
    monthly,
  };
}
