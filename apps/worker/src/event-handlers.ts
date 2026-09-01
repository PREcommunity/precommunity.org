import {
  ChainAuthorityKind,
  ExpenseStatus,
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MetadataStatus,
  MonthlySurplusPolicy,
  PayoutKind,
  PayoutStatus,
  Prisma,
  SafePayoutDelivery,
  SafePayoutProposalStatus,
  SafeGoalActionKind,
  SafeGoalActionProposalStatus,
  SponsorVisibility,
} from '@precommunity/database';
import { isValidIpfsUri, nextMonthlySettlementUtc, utcMonthStart } from '@precommunity/shared';
import { config } from './config';

const contractAddress = config.deployment.escrowAddress.toLowerCase();
const zeroAddress = '0x0000000000000000000000000000000000000000';
const ethereumAddressPattern = /^0x[\da-f]{40}$/i;

const profileByteLimits = {
  displayName: 80,
  websiteUrl: 200,
  bio: 500,
  avatarUri: 200,
} as const;

type AuthorityChange = {
  kind: ChainAuthorityKind;
  address: string;
  enabled: boolean;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
};

type ProfileProjectionEvent = {
  account: string;
  revision: bigint;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
};

type ProfileUpdate = ProfileProjectionEvent & {
  displayName: string;
  websiteUrl: string;
  bio: string;
  avatarUri: string;
  defaultPublic: boolean;
};

function isIndexerSafeText(value: string) {
  // PostgreSQL text cannot contain NUL. U+FFFD indicates that a non-UTF-8 byte
  // sequence was replaced while decoding the ABI string.
  return !value.includes('\0') && !value.includes('\uFFFD');
}

export function isIndexableProfileEventArgs(args: Record<string, unknown>) {
  const { account, revision, displayName, websiteUrl, bio, avatarURI, defaultPublic } = args;
  if (
    typeof account !== 'string' ||
    !ethereumAddressPattern.test(account) ||
    typeof displayName !== 'string' ||
    typeof websiteUrl !== 'string' ||
    typeof bio !== 'string' ||
    typeof avatarURI !== 'string' ||
    typeof defaultPublic !== 'boolean'
  ) {
    return false;
  }
  try {
    BigInt(String(revision));
  } catch {
    return false;
  }
  const fields = [displayName, websiteUrl, bio, avatarURI];
  if (!fields.every(isIndexerSafeText)) return false;
  const displayNameBytes = Buffer.byteLength(displayName, 'utf8');
  return (
    displayNameBytes > 0 &&
    displayNameBytes <= profileByteLimits.displayName &&
    Buffer.byteLength(websiteUrl, 'utf8') <= profileByteLimits.websiteUrl &&
    Buffer.byteLength(bio, 'utf8') <= profileByteLimits.bio &&
    Buffer.byteLength(avatarURI, 'utf8') <= profileByteLimits.avatarUri
  );
}

function warnSkippedProfile(
  event: Pick<DecodedEscrowEvent, 'blockNumber' | 'txHash' | 'logIndex'>,
) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'precommunity-worker',
      event: 'malformed_profile_skipped',
      blockNumber: event.blockNumber.toString(),
      txHash: event.txHash,
      logIndex: event.logIndex,
    }),
  );
}

type EventDatabase = Pick<
  Prisma.TransactionClient,
  | 'chainAuthority'
  | 'user'
  | 'sponsorProfile'
  | 'expense'
  | 'fundingGoal'
  | 'fundingGoalPeriod'
  | 'cryptoContribution'
  | 'payout'
  | 'safePayoutIntent'
  | 'safePayoutProposal'
  | 'safeGoalActionProposal'
>;

export interface DecodedEscrowEvent {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

export interface MetadataRefresh {
  goalId: string;
  uri: string;
}

export async function applyProfileUpdate(
  database: Pick<Prisma.TransactionClient, 'user' | 'sponsorProfile'>,
  update: ProfileUpdate,
) {
  const address = update.account.toLowerCase();
  const user = await database.user.upsert({
    where: { address },
    update: {},
    create: { address },
  });
  const avatarStatus =
    update.avatarUri === ''
      ? MetadataStatus.NOT_SET
      : isValidIpfsUri(update.avatarUri)
        ? MetadataStatus.UNAVAILABLE
        : MetadataStatus.INVALID;
  const projection = {
    active: true,
    revision: update.revision,
    displayName: update.displayName,
    websiteUrl: update.websiteUrl || null,
    bio: update.bio || null,
    avatarUri: update.avatarUri || null,
    avatarStatus,
    defaultPublic: update.defaultPublic,
    chainId: config.deployment.chainId,
    blockNumber: update.blockNumber,
    blockHash: update.blockHash.toLowerCase(),
    txHash: update.txHash.toLowerCase(),
    logIndex: update.logIndex,
  };
  await database.sponsorProfile.upsert({
    where: { userId: user.id },
    update: projection,
    create: { userId: user.id, ...projection },
  });
  return user;
}

export async function applyProfileClear(
  database: Pick<Prisma.TransactionClient, 'user' | 'sponsorProfile'>,
  clear: ProfileProjectionEvent,
) {
  const address = clear.account.toLowerCase();
  const user = await database.user.upsert({
    where: { address },
    update: {},
    create: { address },
  });
  const projection = {
    active: false,
    revision: clear.revision,
    displayName: null,
    websiteUrl: null,
    bio: null,
    avatarUri: null,
    avatarStatus: MetadataStatus.NOT_SET,
    defaultPublic: false,
    chainId: config.deployment.chainId,
    blockNumber: clear.blockNumber,
    blockHash: clear.blockHash.toLowerCase(),
    txHash: clear.txHash.toLowerCase(),
    logIndex: clear.logIndex,
  };
  await database.sponsorProfile.upsert({
    where: { userId: user.id },
    update: projection,
    create: { userId: user.id, ...projection },
  });
  return user;
}

export function resetProfileProjectionAfterReorg(
  database: Pick<Prisma.TransactionClient, 'sponsorProfile'>,
) {
  return database.sponsorProfile.updateMany({
    where: { chainId: config.deployment.chainId },
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
}

export async function applyAuthorityChange(
  database: Pick<Prisma.TransactionClient, 'chainAuthority'>,
  change: AuthorityChange,
) {
  const address = change.address.toLowerCase();
  const identity = {
    chainId: config.deployment.chainId,
    contractAddress,
    address,
    kind: change.kind,
  };

  if (change.kind === ChainAuthorityKind.OWNER) {
    await database.chainAuthority.deleteMany({
      where: {
        chainId: identity.chainId,
        contractAddress: identity.contractAddress,
        kind: ChainAuthorityKind.OWNER,
      },
    });
  }

  if (!change.enabled || address === zeroAddress) {
    if (change.kind !== ChainAuthorityKind.OWNER) {
      await database.chainAuthority.deleteMany({ where: identity });
    }
    return;
  }

  await database.chainAuthority.upsert({
    where: { chainId_contractAddress_address_kind: identity },
    update: {
      blockNumber: change.blockNumber,
      txHash: change.txHash.toLowerCase(),
      logIndex: change.logIndex,
    },
    create: {
      ...identity,
      blockNumber: change.blockNumber,
      txHash: change.txHash.toLowerCase(),
      logIndex: change.logIndex,
    },
  });
}

function assetFor(token: string) {
  const normalized = token.toLowerCase();
  if (normalized === config.deployment.preAddress.toLowerCase()) return FundingAsset.PRE;
  if (normalized === config.deployment.usdcAddress.toLowerCase()) return FundingAsset.USDC;
  throw new Error(`Unsupported token event: ${token}`);
}

function monthlyPolicyFor(value: unknown) {
  const policy = Number(value);
  if (policy === 0) return MonthlySurplusPolicy.PAYOUT_ALL;
  if (policy === 1) return MonthlySurplusPolicy.ROLL_OVER;
  throw new Error(`Unsupported monthly surplus policy: ${String(value)}`);
}

function dateFromChainTimestamp(value: unknown) {
  return new Date(Number(value) * 1000);
}

function addRaw(left: string, right: unknown) {
  return (BigInt(left) + BigInt(String(right))).toString();
}

const pendingGoalActionStatuses = [
  SafeGoalActionProposalStatus.SUBMITTING,
  SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalActionProposalStatus.READY_TO_EXECUTE,
];

async function confirmSafeGoalAction(
  database: Pick<Prisma.TransactionClient, 'safeGoalActionProposal'>,
  goalId: string,
  kind: SafeGoalActionKind,
  txHash: string,
  occurredAt: Date,
  targetPolicy?: MonthlySurplusPolicy,
) {
  const candidates = await database.safeGoalActionProposal.findMany({
    where: {
      status: { in: pendingGoalActionStatuses },
      intent: { goalId, kind },
    },
    include: { intent: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const eligible = targetPolicy
    ? candidates.filter((candidate) => {
        const parameters = candidate.intent.parameters as Record<string, unknown> | null;
        return parameters?.targetPolicy === targetPolicy;
      })
    : candidates;
  const exact = eligible.find(
    (candidate) => candidate.executionTxHash?.toLowerCase() === txHash.toLowerCase(),
  );
  const proposal = exact ?? (eligible.length === 1 ? eligible[0] : null);
  if (!proposal) return;

  await database.safeGoalActionProposal.update({
    where: { id: proposal.id },
    data: {
      status: SafeGoalActionProposalStatus.EXECUTED,
      confirmations: proposal.threshold,
      executionTxHash: txHash.toLowerCase(),
      failureReason: null,
      lastCheckedAt: occurredAt,
      executedAt: occurredAt,
    },
  });
}

export function slugFor(title: string, goalId: string) {
  const base =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 54) || 'goal';
  return `${base}-${goalId.slice(2, 10).toLowerCase()}`;
}

export function visibilityForContribution(profileVisible: boolean) {
  return profileVisible ? SponsorVisibility.PUBLIC : SponsorVisibility.ANONYMOUS;
}

export async function handleDecodedEscrowEvent(
  database: EventDatabase,
  event: DecodedEscrowEvent,
): Promise<MetadataRefresh | null> {
  const { args, blockHash, blockNumber, blockTimestamp, eventName, logIndex, txHash } = event;

  if (eventName === 'OwnershipTransferred') {
    await applyAuthorityChange(database, {
      kind: ChainAuthorityKind.OWNER,
      address: String(args.newOwner),
      enabled: true,
      blockNumber,
      txHash,
      logIndex,
    });
    return null;
  }

  // Ownable2Step announces the nominated owner before the Safe accepts control.
  // Authority must not change until OwnershipTransferred is emitted.
  if (eventName === 'OwnershipTransferStarted') return null;

  if (eventName === 'GoalManagerUpdated') {
    await applyAuthorityChange(database, {
      kind: ChainAuthorityKind.GOAL_MANAGER,
      address: String(args.account),
      enabled: Boolean(args.enabled),
      blockNumber,
      txHash,
      logIndex,
    });
    return null;
  }

  if (eventName === 'ProfileUpdated') {
    if (!isIndexableProfileEventArgs(args)) {
      warnSkippedProfile(event);
      return null;
    }
    await applyProfileUpdate(database, {
      account: String(args.account),
      revision: BigInt(String(args.revision)),
      displayName: String(args.displayName),
      websiteUrl: String(args.websiteUrl),
      bio: String(args.bio),
      avatarUri: String(args.avatarURI),
      defaultPublic: Boolean(args.defaultPublic),
      blockNumber,
      blockHash,
      txHash,
      logIndex,
    });
    return null;
  }

  if (eventName === 'ProfileCleared') {
    await applyProfileClear(database, {
      account: String(args.account),
      revision: BigInt(String(args.revision)),
      blockNumber,
      blockHash,
      txHash,
      logIndex,
    });
    return null;
  }

  const chainGoalId = 'goalId' in args ? String(args.goalId).toLowerCase() : '';
  const occurredAt = new Date(Number(blockTimestamp) * 1000);

  if (eventName === 'GoalCreated') {
    const deadline = new Date(Number(args.deadline) * 1000);
    const draft = await database.expense.findUnique({ where: { pendingChainGoalId: chainGoalId } });
    const wantedSlug = draft?.slug ?? slugFor(String(args.title), chainGoalId);
    const collision = await database.fundingGoal.findUnique({
      where: {
        chainId_slug: { chainId: config.deployment.chainId, slug: wantedSlug },
      },
    });
    const slug =
      collision && collision.chainGoalId !== chainGoalId
        ? slugFor(String(args.title), chainGoalId)
        : wantedSlug;
    const projection = {
      expenseId: draft?.id,
      chainId: config.deployment.chainId,
      creatorAddress: String(args.creator).toLowerCase(),
      goalType: FundingGoalType.ONE_TIME,
      monthlySurplusPolicy: null,
      monthlyFirstSettlementAt: null,
      monthlySettlementDay: null,
      monthlyStopRequestedAt: null,
      monthlyPeriodsSettled: 0,
      slug,
      monthStart: utcMonthStart(deadline),
      title: String(args.title),
      description: String(args.description),
      recipientAddress: String(args.recipient).toLowerCase(),
      deadline,
      metadataUri: String(args.metadataURI) || null,
      metadataStatus: String(args.metadataURI)
        ? MetadataStatus.UNAVAILABLE
        : MetadataStatus.NOT_SET,
      metadata: Prisma.DbNull,
      preTargetRaw: String(args.preTarget),
      usdcTargetRaw: String(args.usdcTarget),
      preRecipientEntitlementRaw: '0',
      usdcRecipientEntitlementRaw: '0',
      preCarryRaw: '0',
      usdcCarryRaw: '0',
      preTreasuryEntitlementRaw: '0',
      usdcTreasuryEntitlementRaw: '0',
      status: FundingGoalStatus.OPEN,
      creationTxHash: txHash,
      creationBlock: blockNumber,
      creationBlockHash: blockHash,
      publishedAt: occurredAt,
      closedAt: null,
    };
    const created = await database.fundingGoal.upsert({
      where: {
        chainId_chainGoalId: { chainId: config.deployment.chainId, chainGoalId },
      },
      update: projection,
      create: {
        chainGoalId,
        ...projection,
      },
    });
    if (draft) {
      await database.expense.update({
        where: { id: draft.id },
        data: { status: ExpenseStatus.PUBLISHED },
      });
    }
    return { goalId: created.id, uri: String(args.metadataURI) };
  }

  const goal = chainGoalId
    ? await database.fundingGoal.findUnique({
        where: {
          chainId_chainGoalId: { chainId: config.deployment.chainId, chainGoalId },
        },
      })
    : null;
  if (!goal) throw new Error(`Event ${eventName} references an unknown goal ${chainGoalId}`);

  if (eventName === 'MonthlyGoalCreated') {
    const startsAt = dateFromChainTimestamp(args.periodStart);
    const endsAt = dateFromChainTimestamp(args.periodEnd);
    const settlementDay = Number(args.settlementDay);
    if (!Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 31) {
      throw new Error(`Unsupported monthly settlement day: ${String(args.settlementDay)}`);
    }
    const surplusPolicy = monthlyPolicyFor(args.surplusPolicy);
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: {
        goalType: FundingGoalType.MONTHLY,
        monthlySurplusPolicy: surplusPolicy,
        monthlyFirstSettlementAt: endsAt,
        monthlySettlementDay: settlementDay,
        monthStart: startsAt,
        deadline: endsAt,
      },
    });
    await database.fundingGoalPeriod.upsert({
      where: { goalId_periodIndex: { goalId: goal.id, periodIndex: 1 } },
      update: { startsAt, endsAt, surplusPolicy },
      create: {
        goalId: goal.id,
        periodIndex: 1,
        startsAt,
        endsAt,
        surplusPolicy,
      },
    });
  } else if (eventName === 'ContributionReceived') {
    const contributor = String(args.contributor).toLowerCase();
    const user = await database.user.upsert({
      where: { address: contributor },
      update: {},
      create: { address: contributor },
    });
    const asset = assetFor(String(args.token));
    await database.cryptoContribution.create({
      data: {
        goalId: goal.id,
        userId: user.id,
        chainId: config.deployment.chainId,
        txHash,
        logIndex,
        blockNumber,
        blockHash,
        contributor,
        asset,
        amountRaw: String(args.amount),
        visibility: visibilityForContribution(Boolean(args.profileVisible)),
        confirmedAt: occurredAt,
      },
    });
    if (goal.goalType === FundingGoalType.MONTHLY) {
      const periodIndex = goal.monthlyPeriodsSettled + 1;
      const period = await database.fundingGoalPeriod.findUnique({
        where: { goalId_periodIndex: { goalId: goal.id, periodIndex } },
      });
      if (!period) throw new Error(`Monthly contribution has no open period ${periodIndex}`);
      await database.fundingGoalPeriod.update({
        where: { id: period.id },
        data:
          asset === FundingAsset.PRE
            ? { preContributedRaw: addRaw(period.preContributedRaw, args.amount) }
            : { usdcContributedRaw: addRaw(period.usdcContributedRaw, args.amount) },
      });
    }
  } else if (eventName === 'MonthlySurplusPolicyUpdated') {
    const surplusPolicy = monthlyPolicyFor(args.newPolicy);
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: { monthlySurplusPolicy: surplusPolicy },
    });
    await database.fundingGoalPeriod.updateMany({
      where: { goalId: goal.id, periodIndex: goal.monthlyPeriodsSettled + 1, settledAt: null },
      data: { surplusPolicy },
    });
    await confirmSafeGoalAction(
      database,
      goal.id,
      SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY,
      txHash,
      occurredAt,
      surplusPolicy,
    );
  } else if (eventName === 'MonthlyGoalStopRequested') {
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: { monthlyStopRequestedAt: occurredAt },
    });
    await confirmSafeGoalAction(
      database,
      goal.id,
      SafeGoalActionKind.REQUEST_MONTHLY_STOP,
      txHash,
      occurredAt,
    );
  } else if (eventName === 'MonthlyPeriodSettled') {
    if (
      goal.monthlySettlementDay === null ||
      goal.monthlySettlementDay < 1 ||
      goal.monthlySettlementDay > 31
    ) {
      throw new Error(`Monthly goal ${chainGoalId} has no valid settlement day`);
    }
    const periodIndex = Number(args.periodIndex);
    const startsAt = dateFromChainTimestamp(args.periodStart);
    const endsAt = dateFromChainTimestamp(args.periodEnd);
    const surplusPolicy = monthlyPolicyFor(args.surplusPolicy);
    const finalPeriod = Boolean(args.finalPeriod);
    await database.fundingGoalPeriod.upsert({
      where: { goalId_periodIndex: { goalId: goal.id, periodIndex } },
      update: {
        startsAt,
        endsAt,
        surplusPolicy,
        finalPeriod,
        settlementTxHash: txHash,
        settlementBlock: blockNumber,
        settlementBlockHash: blockHash,
        settlementLogIndex: logIndex,
        settledAt: occurredAt,
      },
      create: {
        goalId: goal.id,
        periodIndex,
        startsAt,
        endsAt,
        surplusPolicy,
        finalPeriod,
        settlementTxHash: txHash,
        settlementBlock: blockNumber,
        settlementBlockHash: blockHash,
        settlementLogIndex: logIndex,
        settledAt: occurredAt,
      },
    });
    const nextEnd = nextMonthlySettlementUtc(endsAt, goal.monthlySettlementDay);
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: {
        monthlyPeriodsSettled: periodIndex,
        ...(!finalPeriod ? { deadline: nextEnd } : {}),
      },
    });
    if (!finalPeriod) {
      await database.fundingGoalPeriod.upsert({
        where: { goalId_periodIndex: { goalId: goal.id, periodIndex: periodIndex + 1 } },
        update: {},
        create: {
          goalId: goal.id,
          periodIndex: periodIndex + 1,
          startsAt: endsAt,
          endsAt: nextEnd,
          surplusPolicy,
        },
      });
    }
  } else if (eventName === 'MonthlyTokenSettled') {
    const periodIndex = Number(args.periodIndex);
    const asset = assetFor(String(args.token));
    const periodData = {
      ...(asset === FundingAsset.PRE
        ? {
            preContributedRaw: String(args.periodContributed),
            preCarryInRaw: String(args.carryIn),
            preRecipientEntitlementAddedRaw: String(args.recipientEntitlementAdded),
            preCarryOutRaw: String(args.carryOut),
          }
        : {
            usdcContributedRaw: String(args.periodContributed),
            usdcCarryInRaw: String(args.carryIn),
            usdcRecipientEntitlementAddedRaw: String(args.recipientEntitlementAdded),
            usdcCarryOutRaw: String(args.carryOut),
          }),
    };
    await database.fundingGoalPeriod.update({
      where: { goalId_periodIndex: { goalId: goal.id, periodIndex } },
      data: periodData,
    });
    await database.fundingGoalPeriod.updateMany({
      where: { goalId: goal.id, periodIndex: periodIndex + 1, settledAt: null },
      data:
        asset === FundingAsset.PRE
          ? { preCarryInRaw: String(args.carryOut) }
          : { usdcCarryInRaw: String(args.carryOut) },
    });
    await database.fundingGoal.update({
      where: { id: goal.id },
      data:
        asset === FundingAsset.PRE
          ? {
              preCarryRaw: String(args.carryOut),
              preRecipientEntitlementRaw: addRaw(
                goal.preRecipientEntitlementRaw,
                args.recipientEntitlementAdded,
              ),
            }
          : {
              usdcCarryRaw: String(args.carryOut),
              usdcRecipientEntitlementRaw: addRaw(
                goal.usdcRecipientEntitlementRaw,
                args.recipientEntitlementAdded,
              ),
            },
    });
  } else if (eventName === 'GoalClosed') {
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: {
        status: FundingGoalStatus.CLOSED,
        closedAt: occurredAt,
        preRecipientEntitlementRaw: String(args.preRecipientEntitlement),
        usdcRecipientEntitlementRaw: String(args.usdcRecipientEntitlement),
      },
    });
  } else if (eventName === 'GoalCancelled') {
    let treasuryEntitlements = {};
    if (goal.goalType === FundingGoalType.ONE_TIME) {
      const contributions = await database.cryptoContribution.findMany({
        where: { goalId: goal.id },
        select: { asset: true, amountRaw: true },
      });
      const total = (asset: FundingAsset) =>
        contributions
          .filter((contribution) => contribution.asset === asset)
          .reduce((sum, contribution) => sum + BigInt(contribution.amountRaw), 0n)
          .toString();
      treasuryEntitlements = {
        preTreasuryEntitlementRaw: total(FundingAsset.PRE),
        usdcTreasuryEntitlementRaw: total(FundingAsset.USDC),
      };
    }
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: {
        status: FundingGoalStatus.CANCELLED,
        closedAt: occurredAt,
        ...treasuryEntitlements,
      },
    });
  } else if (eventName === 'MonthlyGoalCancelled') {
    await database.fundingGoal.update({
      where: { id: goal.id },
      data: {
        preTreasuryEntitlementRaw: addRaw(
          goal.preTreasuryEntitlementRaw,
          args.preTreasuryEntitlementAdded,
        ),
        usdcTreasuryEntitlementRaw: addRaw(
          goal.usdcTreasuryEntitlementRaw,
          args.usdcTreasuryEntitlementAdded,
        ),
        preCarryRaw: '0',
        usdcCarryRaw: '0',
      },
    });
    await confirmSafeGoalAction(
      database,
      goal.id,
      SafeGoalActionKind.CANCEL_MONTHLY,
      txHash,
      occurredAt,
    );
  } else if (eventName === 'ExpenseReleased' || eventName === 'CancelledFundsReleased') {
    const kind = eventName === 'ExpenseReleased' ? PayoutKind.EXPENSE : PayoutKind.CANCELLED_FUNDS;
    const asset = assetFor(String(args.token));
    const amountRaw = String(args.amount);
    const candidates = await database.payout.findMany({
      where: { goalId: goal.id, kind, asset, amountRaw, status: PayoutStatus.PROPOSED },
      include: { safeIntent: { include: { proposal: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const exact = candidates.find(
      (candidate) =>
        candidate.safeIntent?.proposal?.executionTxHash?.toLowerCase() === txHash.toLowerCase(),
    );
    const soleCandidate = candidates.length === 1 ? candidates[0] : null;
    const proposed =
      exact ??
      (soleCandidate && !soleCandidate.safeIntent?.proposal?.executionTxHash
        ? soleCandidate
        : null);
    const recipientAddress = String(args.payoutRecipient).toLowerCase();
    if (proposed) {
      await database.payout.update({
        where: { id: proposed.id },
        data: {
          status: PayoutStatus.EXECUTED,
          chainTxHash: txHash,
          recipientAddress,
          executedAt: occurredAt,
        },
      });
      if (
        proposed.safeIntent?.delivery === SafePayoutDelivery.SERVICE &&
        proposed.safeIntent.proposal
      ) {
        await database.safePayoutProposal.update({
          where: { id: proposed.safeIntent.proposal.id },
          data: {
            status: SafePayoutProposalStatus.EXECUTED,
            confirmations: proposed.safeIntent.proposal.threshold,
            executionTxHash: txHash,
            failureReason: null,
            lastCheckedAt: occurredAt,
            executedAt: occurredAt,
          },
        });
      }
      const manualIntent = proposed.safeIntent;
      if (manualIntent?.delivery === SafePayoutDelivery.MANUAL) {
        await database.safePayoutIntent.update({
          where: { id: manualIntent.id },
          data: { consumedAt: occurredAt },
        });
      }
    } else {
      await database.payout.create({
        data: {
          goalId: goal.id,
          kind,
          asset,
          amountRaw,
          recipientAddress,
          chainTxHash: txHash,
          status: PayoutStatus.EXECUTED,
          executedAt: occurredAt,
        },
      });
    }
  }

  return null;
}
