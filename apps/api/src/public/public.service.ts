import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ExpenseStatus,
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MetadataStatus,
  PayoutStatus,
  PayoutKind,
  Prisma,
  SponsorVisibility,
} from '@precommunity/database';
import type {
  AssetCode,
  DashboardResponse,
  GoalContributionsPage,
  GoalPreviewResponse,
} from '@precommunity/shared';
import {
  PROJECT_SLUG,
  canonicalGoalMetadata,
  deploymentStateKey,
  explorerTransactionUrl,
  isDeploymentConfigured,
  isValidIpfsUri,
  nextMonthlySettlementUtc,
} from '@precommunity/shared';
import { encodeFunctionData, formatUnits, getAddress } from 'viem';
import { PRECOMMUNITY_ESCROW_ABI } from '@precommunity/shared';
import { deploymentTransactionRequest } from '../common/deployment-transaction';
import type { ProfileProjection } from '../common/public-profile';
import { profileAvatarPath, shortenedAddress, visibleProfile } from '../common/public-profile';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { mapPublicFundingGoal, totalFundingProgress } from './funding-presenter';

export { fundingProgress, metadataFrom } from './funding-presenter';

function monthFromQuery(value?: string) {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  if (!/^\d{4}-\d{2}$/.test(value)) throw new NotFoundException('Month must use YYYY-MM');
  const month = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(month.getTime())) throw new NotFoundException('Month must use YYYY-MM');
  return month;
}

export function sponsorAttribution(
  visibility: SponsorVisibility,
  address: string,
  profile: ProfileProjection | null | undefined,
) {
  const visible = visibleProfile(profile);
  if (visible)
    return {
      label: visible.displayName || shortenedAddress(address),
      sponsorUrl: `/community/profiles/${encodeURIComponent(address)}`,
      sponsorAvatarUrl: profileAvatarPath(address, visible) ?? undefined,
    };
  if (visibility !== SponsorVisibility.PUBLIC) return { label: 'Anonymous user' };
  return { label: shortenedAddress(address) };
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const avatarMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function imageMimeFromMagic(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

async function readLimitedBody(response: Response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AVATAR_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeException('Avatar exceeds the 2 MiB limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

type ContributionCursor = { blockNumber: bigint; txHash: string; logIndex: number; id: string };

function encodeContributionCursor(value: ContributionCursor) {
  return Buffer.from(
    JSON.stringify({
      b: value.blockNumber.toString(),
      t: value.txHash,
      l: value.logIndex,
      i: value.id,
    }),
  ).toString('base64url');
}

function decodeContributionCursor(value: string): ContributionCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      b?: unknown;
      t?: unknown;
      l?: unknown;
      i?: unknown;
    };
    if (
      typeof parsed.b !== 'string' ||
      !/^\d+$/.test(parsed.b) ||
      typeof parsed.t !== 'string' ||
      !/^0x[a-f0-9]{64}$/.test(parsed.t) ||
      typeof parsed.l !== 'number' ||
      !Number.isInteger(parsed.l) ||
      parsed.l < 0 ||
      typeof parsed.i !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.i)
    )
      throw new Error('invalid cursor');
    return { blockNumber: BigInt(parsed.b), txHash: parsed.t, logIndex: parsed.l, id: parsed.i };
  } catch {
    throw new BadRequestException('Invalid contributions cursor');
  }
}

function explorerTransaction(txHash: string) {
  return explorerTransactionUrl(txHash, config.deployment);
}

function nextUtcMonthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function publicPeriod(
  period: {
    periodIndex: number;
    startsAt: Date;
    endsAt: Date;
    surplusPolicy: 'PAYOUT_ALL' | 'ROLL_OVER';
    finalPeriod: boolean;
    preContributedRaw: string;
    usdcContributedRaw: string;
    preCarryInRaw: string;
    usdcCarryInRaw: string;
    preRecipientEntitlementAddedRaw: string;
    usdcRecipientEntitlementAddedRaw: string;
    preCarryOutRaw: string;
    usdcCarryOutRaw: string;
    settlementTxHash: string | null;
    settlementBlock: bigint | null;
    settlementBlockHash: string | null;
    settlementLogIndex: number | null;
    settledAt: Date | null;
  },
  goal: { preTargetRaw: string; usdcTargetRaw: string },
) {
  return {
    periodIndex: period.periodIndex,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
    surplusPolicy: period.surplusPolicy,
    finalPeriod: period.finalPeriod,
    settledAt: period.settledAt?.toISOString() ?? null,
    settlementTxHash: period.settlementTxHash as `0x${string}` | null,
    settlementBlock: period.settlementBlock?.toString() ?? null,
    settlementBlockHash: period.settlementBlockHash as `0x${string}` | null,
    settlementLogIndex: period.settlementLogIndex,
    assets: [
      {
        asset: 'PRE' as const,
        target: formatUnits(BigInt(goal.preTargetRaw), 18),
        contributed: formatUnits(BigInt(period.preContributedRaw), 18),
        carryIn: formatUnits(BigInt(period.preCarryInRaw), 18),
        vested: formatUnits(BigInt(period.preRecipientEntitlementAddedRaw), 18),
        carryOut: formatUnits(BigInt(period.preCarryOutRaw), 18),
      },
      {
        asset: 'USDC' as const,
        target: formatUnits(BigInt(goal.usdcTargetRaw), 6),
        contributed: formatUnits(BigInt(period.usdcContributedRaw), 6),
        carryIn: formatUnits(BigInt(period.usdcCarryInRaw), 6),
        vested: formatUnits(BigInt(period.usdcRecipientEntitlementAddedRaw), 6),
        carryOut: formatUnits(BigInt(period.usdcCarryOutRaw), 6),
      },
    ].filter((item) => item.target !== '0'),
  };
}

interface FundingAmountAggregateRow {
  goalId: string;
  asset: FundingAsset;
  kind?: PayoutKind;
  status?: PayoutStatus;
  amountRaw: string;
}

@Injectable()
export class PublicService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async goalPreview(token: string): Promise<GoalPreviewResponse> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException('Preview not found');
    const draft = await this.prisma.expense.findUnique({
      where: {
        previewToken: token,
        archivedAt: null,
        status: { in: [ExpenseStatus.DRAFT, ExpenseStatus.PENDING_CHAIN, ExpenseStatus.PUBLISHED] },
        subproject: { project: { slug: PROJECT_SLUG } },
      },
      select: {
        name: true,
        purpose: true,
        status: true,
        category: true,
        cadence: true,
        recipientAddress: true,
        deadline: true,
        monthlySurplusPolicy: true,
        firstSettlementAtOverride: true,
        discussionUrl: true,
        metadataUri: true,
        metadataDocuments: true,
        subproject: { select: { name: true, slug: true } },
        targets: { select: { asset: true, amount: true } },
        goals: {
          where: {
            chainId: config.deployment.chainId,
            creationTxHash: { not: null },
            creationBlock: { not: null },
            status: {
              in: [
                FundingGoalStatus.OPEN,
                FundingGoalStatus.CLOSED,
                FundingGoalStatus.SETTLED,
                FundingGoalStatus.CANCELLED,
              ],
            },
          },
          orderBy: { creationBlock: 'desc' },
          take: 1,
          select: { slug: true },
        },
      },
    });
    if (!draft) throw new NotFoundException('Preview not found');
    if (draft.goals[0]) return { kind: 'published', slug: draft.goals[0].slug };
    if (draft.status !== ExpenseStatus.DRAFT && draft.status !== ExpenseStatus.PENDING_CHAIN)
      throw new NotFoundException('Preview not found');

    const documents = Array.isArray(draft.metadataDocuments)
      ? draft.metadataDocuments.flatMap((document) =>
          document &&
          typeof document === 'object' &&
          !Array.isArray(document) &&
          typeof document.label === 'string' &&
          typeof document.url === 'string'
            ? [{ label: document.label, url: document.url }]
            : [],
        )
      : [];
    const metadata = canonicalGoalMetadata({
      category: draft.category ?? undefined,
      subproject: draft.subproject,
      discussionUrl: draft.discussionUrl ?? undefined,
      documents,
    });
    return {
      kind: 'draft',
      draft: {
        title: draft.name,
        description: draft.purpose,
        status: draft.status,
        category: metadata.category ?? null,
        subproject: metadata.subproject ?? null,
        recipientAddress: draft.recipientAddress,
        cadence: draft.cadence,
        deadline: draft.deadline?.toISOString() ?? null,
        monthlySurplusPolicy: draft.monthlySurplusPolicy,
        firstSettlementAt: draft.firstSettlementAtOverride?.toISOString() ?? null,
        discussionUrl: metadata.discussionUrl ?? null,
        metadataUri:
          draft.metadataUri && isValidIpfsUri(draft.metadataUri) ? draft.metadataUri : null,
        documents: metadata.documents ?? [],
        targets: draft.targets
          .map((target) => ({ asset: target.asset, amount: target.amount.toString() }))
          .filter((target) => target.amount !== '0'),
      },
    };
  }

  private async syncState() {
    if (!isDeploymentConfigured(config.deployment)) return null;
    const state = await this.prisma.indexerState.findUnique({
      where: { key: deploymentStateKey(config.deployment) },
    });
    if (!state)
      throw new ServiceUnavailableException(
        'The chain indexer has not completed its first confirmed sync',
      );
    if (Date.now() - state.updatedAt.getTime() > 3 * 60_000) {
      throw new ServiceUnavailableException('The chain indexer is unavailable or stale');
    }
    return state;
  }

  async dashboard(monthValue?: string): Promise<DashboardResponse> {
    const month = monthFromQuery(monthValue);
    const nextMonth = nextUtcMonthStart(month);
    if (!isDeploymentConfigured(config.deployment)) {
      return {
        source: 'CHAIN',
        project: {
          name: 'precommunity',
          slug: 'precommunity',
          description: 'Independent community funding with public proof on Base.',
        },
        month: month.toISOString().slice(0, 7),
        generatedAt: new Date().toISOString(),
        chainId: config.deployment.chainId,
        network: config.deployment.networkName,
        escrowAddress: config.deployment.escrowAddress,
        indexedThroughBlock: null,
        confirmations: config.deployment.confirmations,
        lastIndexedAt: null,
        syncStatus: 'AWAITING_DEPLOYMENT',
        totals: [],
        goals: [],
        activity: [],
      };
    }
    const state = await this.syncState();
    const goals = await this.prisma.fundingGoal.findMany({
      where: {
        chainId: config.deployment.chainId,
        OR: [
          {
            goalType: FundingGoalType.ONE_TIME,
            publishedAt: { lt: nextMonth },
            OR: [{ deadline: { gt: month } }, { closedAt: { gte: month } }],
          },
          {
            goalType: FundingGoalType.MONTHLY,
            periods: {
              some: {
                startsAt: { lt: nextMonth },
                endsAt: { gt: month },
              },
            },
          },
        ],
        creationTxHash: { not: null },
        creationBlock: { not: null },
        status: {
          in: [
            FundingGoalStatus.OPEN,
            FundingGoalStatus.CLOSED,
            FundingGoalStatus.SETTLED,
            FundingGoalStatus.CANCELLED,
          ],
        },
      },
      include: {
        expense: { select: { discussionUrl: true } },
        periods: {
          where: {
            startsAt: { lt: nextMonth },
            endsAt: { gt: month },
          },
          orderBy: { periodIndex: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ creationBlock: 'asc' }, { title: 'asc' }],
    });

    const fundedByGoal = new Map<string, bigint>();
    const releasedByGoal = new Map<string, bigint>();
    const reservedByGoal = new Map<string, bigint>();
    const goalIds = goals.map((goal) => goal.id);
    let activity: DashboardResponse['activity'] = [];
    if (goalIds.length) {
      const [fundedRows, releasedRows, recentContributions, datedPayouts, undatedPayouts] =
        await Promise.all([
          this.prisma.$queryRaw<FundingAmountAggregateRow[]>(Prisma.sql`
          SELECT
            "goalId",
            "asset"::text AS "asset",
            SUM("amountRaw"::numeric)::text AS "amountRaw"
          FROM "CryptoContribution"
          WHERE "goalId" IN (${Prisma.join(goalIds.map((id) => Prisma.sql`${id}::uuid`))})
          GROUP BY "goalId", "asset"
        `),
          this.prisma.$queryRaw<FundingAmountAggregateRow[]>(Prisma.sql`
          SELECT
            "goalId",
            "asset"::text AS "asset",
            "kind"::text AS "kind",
            "status"::text AS "status",
            SUM("amountRaw"::numeric)::text AS "amountRaw"
          FROM "Payout"
          WHERE "goalId" IN (${Prisma.join(goalIds.map((id) => Prisma.sql`${id}::uuid`))})
            AND "status" IN (
              ${PayoutStatus.EXECUTED}::"PayoutStatus",
              ${PayoutStatus.PROPOSED}::"PayoutStatus"
            )
          GROUP BY "goalId", "asset", "kind", "status"
        `),
          this.prisma.cryptoContribution.findMany({
            where: { goalId: { in: goalIds } },
            select: {
              id: true,
              amountRaw: true,
              asset: true,
              visibility: true,
              contributor: true,
              confirmedAt: true,
              txHash: true,
              user: { select: { profile: true } },
            },
            orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
            take: 20,
          }),
          this.prisma.payout.findMany({
            where: {
              goalId: { in: goalIds },
              status: PayoutStatus.EXECUTED,
              chainTxHash: { not: null },
              executedAt: { not: null },
            },
            select: {
              id: true,
              amountRaw: true,
              asset: true,
              kind: true,
              chainTxHash: true,
              executedAt: true,
              createdAt: true,
              goal: { select: { title: true } },
            },
            orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
            take: 20,
          }),
          this.prisma.payout.findMany({
            where: {
              goalId: { in: goalIds },
              status: PayoutStatus.EXECUTED,
              chainTxHash: { not: null },
              executedAt: null,
            },
            select: {
              id: true,
              amountRaw: true,
              asset: true,
              kind: true,
              chainTxHash: true,
              executedAt: true,
              createdAt: true,
              goal: { select: { title: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
          }),
        ]);

      for (const row of fundedRows)
        fundedByGoal.set(`${row.goalId}:${row.asset}`, BigInt(row.amountRaw));
      for (const row of releasedRows) {
        const kind = row.kind ?? PayoutKind.EXPENSE;
        const destination =
          !row.status || row.status === PayoutStatus.EXECUTED ? releasedByGoal : reservedByGoal;
        destination.set(`${row.goalId}:${row.asset}:${kind}`, BigInt(row.amountRaw));
      }

      activity = [
        ...recentContributions.map((item) => ({
          ...sponsorAttribution(item.visibility, item.contributor, item.user.profile),
          id: item.id,
          kind: 'CONTRIBUTION' as const,
          amount: formatUnits(BigInt(item.amountRaw), item.asset === FundingAsset.PRE ? 18 : 6),
          asset: item.asset as AssetCode,
          occurredAt: item.confirmedAt.toISOString(),
          transactionUrl: explorerTransaction(item.txHash),
        })),
        ...[...datedPayouts, ...undatedPayouts].map((item) => ({
          id: item.id,
          kind: 'PAYOUT' as const,
          label:
            item.kind === PayoutKind.CANCELLED_FUNDS
              ? 'Cancelled funds released to treasury'
              : `Released to ${item.goal.title}`,
          amount: formatUnits(BigInt(item.amountRaw), item.asset === FundingAsset.PRE ? 18 : 6),
          asset: item.asset as AssetCode,
          occurredAt: (item.executedAt ?? item.createdAt).toISOString(),
          transactionUrl: explorerTransaction(item.chainTxHash!),
        })),
      ]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, 20);
    }

    const publicGoals = goals.map((goal) =>
      mapPublicFundingGoal(goal, fundedByGoal, releasedByGoal, reservedByGoal),
    );

    const assets: AssetCode[] = ['PRE', 'USDC'];
    const totals = assets
      .map((asset) => {
        const lines = publicGoals
          .flatMap((goal) => goal.progress)
          .filter((item) => item.asset === asset);
        return totalFundingProgress(asset, lines);
      })
      .filter((item) => item.target !== '0');

    return {
      source: 'CHAIN',
      project: {
        name: 'precommunity',
        slug: 'precommunity',
        description: 'Independent community funding with public proof on Base.',
      },
      month: month.toISOString().slice(0, 7),
      generatedAt: new Date().toISOString(),
      chainId: config.deployment.chainId,
      network: config.deployment.networkName,
      escrowAddress: config.deployment.escrowAddress,
      indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
      confirmations: config.deployment.confirmations,
      lastIndexedAt: state?.updatedAt.toISOString() ?? null,
      syncStatus: state ? 'SYNCED' : 'AWAITING_DEPLOYMENT',
      totals,
      goals: publicGoals,
      activity,
    };
  }

  async goal(slug: string, month?: string) {
    let goalMonth = month;
    if (!goalMonth && isDeploymentConfigured(config.deployment)) {
      const indexedGoal = await this.prisma.fundingGoal.findUnique({
        where: {
          chainId_slug: { chainId: config.deployment.chainId, slug },
        },
        select: {
          monthStart: true,
          periods: {
            orderBy: { periodIndex: 'desc' },
            take: 1,
            select: { endsAt: true },
          },
        },
      });
      goalMonth = (indexedGoal?.periods[0]?.endsAt ?? indexedGoal?.monthStart)
        ?.toISOString()
        .slice(0, 7);
    }
    const dashboard = await this.dashboard(goalMonth);
    const goal = dashboard.goals.find((item) => item.slug === slug);
    if (!goal) throw new NotFoundException('Goal not found in the confirmed ledger');
    const payouts = await this.prisma.payout.findMany({
      where: {
        goalId: goal.id,
        status: PayoutStatus.EXECUTED,
        chainTxHash: { not: null },
        executedAt: { not: null },
      },
      select: {
        asset: true,
        amountRaw: true,
        recipientAddress: true,
        chainTxHash: true,
        executedAt: true,
      },
      orderBy: [{ executedAt: 'desc' }, { chainTxHash: 'desc' }],
    });
    return {
      ...goal,
      payouts: payouts.map((item) => ({
        asset: item.asset as AssetCode,
        amount: formatUnits(BigInt(item.amountRaw), item.asset === FundingAsset.PRE ? 18 : 6),
        recipientAddress: item.recipientAddress as `0x${string}`,
        transactionUrl: explorerTransaction(item.chainTxHash!),
        executedAt: item.executedAt!.toISOString(),
      })),
    };
  }

  async periods(slug: string, cursorValue?: string, limitValue?: string) {
    await this.syncState();
    const limit = limitValue === undefined ? 12 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be an integer from 1 to 100');
    }
    const cursor = cursorValue === undefined ? null : Number(cursorValue);
    if (cursor !== null && (!Number.isInteger(cursor) || cursor < 1)) {
      throw new BadRequestException('Invalid periods cursor');
    }
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { chainId_slug: { chainId: config.deployment.chainId, slug } },
      select: { id: true, goalType: true, preTargetRaw: true, usdcTargetRaw: true },
    });
    if (!goal) throw new NotFoundException('Goal not found in the confirmed ledger');
    if (goal.goalType !== FundingGoalType.MONTHLY) {
      throw new BadRequestException('Period history is available only for monthly goals');
    }
    const rows = await this.prisma.fundingGoalPeriod.findMany({
      where: { goalId: goal.id, ...(cursor ? { periodIndex: { lt: cursor } } : {}) },
      orderBy: { periodIndex: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((period) => publicPeriod(period, goal)),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]!.periodIndex) : null,
    };
  }

  async settlementRequest(slug: string) {
    const state = await this.syncState();
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { chainId_slug: { chainId: config.deployment.chainId, slug } },
    });
    if (!goal) throw new NotFoundException('Goal not found in the confirmed ledger');
    if (goal.goalType !== FundingGoalType.MONTHLY || goal.status !== FundingGoalStatus.OPEN) {
      throw new BadRequestException('Settlement is available only for an open monthly goal');
    }
    if (
      !goal.monthlyFirstSettlementAt ||
      goal.monthlySettlementDay === null ||
      goal.monthlySettlementDay < 1 ||
      goal.monthlySettlementDay > 31
    ) {
      throw new ServiceUnavailableException(
        'The confirmed monthly schedule is incomplete; wait for the indexer to rebuild it',
      );
    }
    const now = new Date();
    let boundary = goal.deadline;
    let periodsDue = 0;
    while (boundary <= now && periodsDue < 1_200) {
      periodsDue += 1;
      if (goal.monthlyStopRequestedAt) break;
      boundary = nextMonthlySettlementUtc(boundary, goal.monthlySettlementDay);
    }
    if (periodsDue === 0) {
      throw new BadRequestException('The current monthly period is not due for settlement');
    }
    const maxPeriods = Math.min(periodsDue, 24);
    const data = encodeFunctionData({
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'settleMonthlyGoal',
      args: [goal.chainGoalId as `0x${string}`, maxPeriods],
    });
    return {
      goalId: goal.chainGoalId,
      periodsDue,
      maxPeriods,
      remainingAfterThisTransaction: Math.max(0, periodsDue - maxPeriods),
      indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
      transactionRequest: deploymentTransactionRequest({
        to: getAddress(config.deployment.escrowAddress),
        value: '0',
        data,
      }),
    };
  }

  async contributions(
    slug: string,
    cursorValue?: string,
    limitValue?: string,
  ): Promise<GoalContributionsPage> {
    await this.syncState();
    const limit = limitValue === undefined ? 25 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be an integer from 1 to 100');
    }
    const goal = await this.prisma.fundingGoal.findUnique({
      where: {
        chainId_slug: { chainId: config.deployment.chainId, slug },
      },
      select: { id: true },
    });
    if (!goal) throw new NotFoundException('Goal not found in the confirmed ledger');
    const cursor = cursorValue ? decodeContributionCursor(cursorValue) : null;
    const after: Prisma.CryptoContributionWhereInput | undefined = cursor
      ? {
          OR: [
            { blockNumber: { lt: cursor.blockNumber } },
            { blockNumber: cursor.blockNumber, txHash: { lt: cursor.txHash } },
            {
              blockNumber: cursor.blockNumber,
              txHash: cursor.txHash,
              logIndex: { lt: cursor.logIndex },
            },
            {
              blockNumber: cursor.blockNumber,
              txHash: cursor.txHash,
              logIndex: cursor.logIndex,
              id: { lt: cursor.id },
            },
          ],
        }
      : undefined;
    const rows = await this.prisma.cryptoContribution.findMany({
      where: { goalId: goal.id, ...after },
      include: { user: { include: { profile: true } } },
      orderBy: [{ blockNumber: 'desc' }, { txHash: 'desc' }, { logIndex: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((item) => ({
        ...sponsorAttribution(item.visibility, item.contributor, item.user.profile),
        id: item.id,
        amount: formatUnits(BigInt(item.amountRaw), item.asset === FundingAsset.PRE ? 18 : 6),
        asset: item.asset,
        visibility: item.visibility,
        occurredAt: item.confirmedAt.toISOString(),
        blockNumber: item.blockNumber.toString(),
        transactionUrl: explorerTransaction(item.txHash),
      })),
      nextCursor:
        hasMore && page.length
          ? encodeContributionCursor({
              blockNumber: page[page.length - 1]!.blockNumber,
              txHash: page[page.length - 1]!.txHash,
              logIndex: page[page.length - 1]!.logIndex,
              id: page[page.length - 1]!.id,
            })
          : null,
    };
  }

  async avatar(addressValue: string, revisionValue: string) {
    let address: string;
    try {
      address = getAddress(addressValue).toLowerCase();
    } catch {
      throw new BadRequestException('A valid wallet address is required');
    }
    if (!/^\d+$/.test(revisionValue ?? ''))
      throw new BadRequestException('A valid profile revision is required');
    const revision = BigInt(revisionValue);
    const user = await this.prisma.user.findUnique({
      where: { address },
      select: { profile: true },
    });
    const profile = visibleProfile(user?.profile);
    if (
      !profile ||
      profile.revision !== revision ||
      !profile.avatarUri ||
      profile.avatarStatus === MetadataStatus.INVALID
    ) {
      throw new NotFoundException('Profile avatar not found');
    }
    const markStatus = (status: MetadataStatus) =>
      this.prisma.sponsorProfile.updateMany({
        where: { id: profile.id, revision },
        data: { avatarStatus: status },
      });
    if (!isValidIpfsUri(profile.avatarUri)) {
      await markStatus(MetadataStatus.INVALID);
      throw new NotFoundException('Profile avatar not found');
    }
    const path = profile.avatarUri
      .slice('ipfs://'.length)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    const gatewayBase = config.IPFS_GATEWAY_URL.endsWith('/')
      ? config.IPFS_GATEWAY_URL
      : `${config.IPFS_GATEWAY_URL}/`;
    let upstream: Response;
    try {
      upstream = await fetch(new URL(path, gatewayBase), {
        headers: { accept: 'image/png,image/jpeg,image/webp' },
        redirect: 'error',
        signal: AbortSignal.timeout(config.IPFS_TIMEOUT_MS),
      });
    } catch {
      await markStatus(MetadataStatus.UNAVAILABLE);
      throw new BadGatewayException('Avatar source is temporarily unavailable');
    }
    if (!upstream.ok) {
      await markStatus(MetadataStatus.UNAVAILABLE);
      throw new BadGatewayException('Avatar source is temporarily unavailable');
    }
    const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) {
      await markStatus(MetadataStatus.INVALID);
      throw new PayloadTooLargeException('Avatar exceeds the 2 MiB limit');
    }
    const declaredMime =
      upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!avatarMimeTypes.has(declaredMime)) {
      await markStatus(MetadataStatus.INVALID);
      throw new UnsupportedMediaTypeException('Avatar must be PNG, JPEG or WebP');
    }
    let body: Buffer;
    try {
      body = await readLimitedBody(upstream);
    } catch (error) {
      await markStatus(MetadataStatus.INVALID);
      throw error;
    }
    const detectedMime = imageMimeFromMagic(body);
    if (!detectedMime || detectedMime !== declaredMime) {
      await markStatus(MetadataStatus.INVALID);
      throw new UnsupportedMediaTypeException('Avatar MIME type does not match its content');
    }
    await markStatus(MetadataStatus.AVAILABLE);
    return { body, contentType: detectedMime };
  }

  async report(filters: { month?: string; year?: string; subproject?: string; category?: string }) {
    if (filters.month && filters.year)
      throw new BadRequestException('Choose either month or year, not both');
    if (filters.year && !/^\d{4}$/.test(filters.year))
      throw new BadRequestException('Year must use YYYY');
    const months = filters.year
      ? Array.from(
          { length: 12 },
          (_, index) => `${filters.year}-${String(index + 1).padStart(2, '0')}`,
        )
      : [filters.month];
    const dashboards = await Promise.all(months.map((month) => this.dashboard(month)));
    const filtered = dashboards.map((dashboard) => {
      const goals = dashboard.goals.filter((goal) => {
        const subprojectMatches =
          !filters.subproject || goal.subproject?.slug === filters.subproject;
        const categoryMatches =
          !filters.category || goal.category?.toLowerCase() === filters.category.toLowerCase();
        return subprojectMatches && categoryMatches;
      });
      const totals = (['PRE', 'USDC'] as AssetCode[])
        .map((asset) =>
          totalFundingProgress(
            asset,
            goals.flatMap((goal) => goal.progress).filter((item) => item.asset === asset),
          ),
        )
        .filter((item) => item.target !== '0');
      return { ...dashboard, goals, totals, activity: [] };
    });
    return { generatedAt: new Date().toISOString(), filters, months: filtered };
  }
}
