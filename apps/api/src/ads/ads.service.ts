import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdCreativeStatus,
  AdReportStatus,
  Prisma,
  type AdStakePosition,
} from '@precommunity/database';
import {
  ADS_ALGORITHM_VERSION,
  AdsTextValidationError,
  PROJECT_SLUG,
  adKeywordId,
  adsKeywordCandidates,
  adsUtcDay,
  normalizeAdKeyword,
  type AdAdminReportGroup,
  type AdAdminReportPage,
  type AdAdminRevisionView,
  type AdApiKeyView,
  type AdApiKeyCreateResponse,
  type AdCampaignView,
  type AdsKeywordCandidate,
  type AdKeywordPositionView,
  type AdKeywordResponse,
  type AdResolveCreative,
  type AdResolveResponse,
  type AdRevisionView,
} from '@precommunity/shared';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { writeAuditEvent } from '../common/audit';
import { config } from '../config';
import {
  ADS_CHAIN_ADAPTER,
  type AdsChainAdapter,
  type AdsChainSnapshot,
} from './ads-chain.adapter';
import {
  AdModerationAction,
  AdReportResolutionAction,
  type AdCreativeInputDto,
  type CreateAdCampaignDto,
  type CreateAdApiKeyDto,
  type ReportAdDto,
} from './ads.dto';
import { AdsMetricsService } from './ads-metrics.service';
import { hashAdApiKey } from './ads-api-key.guard';

const RESOLVER_CACHE_MS = 15_000;
const RESOLVER_CACHE_MAX = 5_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_REPORT_PREVIEW_LIMIT = 25;
const DESTINATION_URL_MAX_CHARACTERS = 2_048;
const API_KEY_METADATA_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

function canSuspendRevision(revision: { status: AdCreativeStatus; moderatedAt: Date | null }) {
  return (
    revision.status === AdCreativeStatus.APPROVED ||
    (revision.status === AdCreativeStatus.SUPERSEDED && revision.moderatedAt !== null)
  );
}

function apiKeyView(key: {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): AdApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

type EligibleCampaign = {
  canonicalKeyword: string;
  pausedAt: Date | null;
  user: { address: string };
  activeRevision: {
    id: string;
    headline: string;
    description: string;
    destinationUrl: string;
    displayDomain: string;
    status: AdCreativeStatus;
  } | null;
};

function rawStake(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function compareAdStakePositions(left: AdStakePosition, right: AdStakePosition) {
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  const bidDifference = rawStake(right.bidUsdRaw) - rawStake(left.bidUsdRaw);
  if (bidDifference !== 0n) return bidDifference > 0n ? 1 : -1;
  const leftAddress = left.stakerAddress.toLowerCase();
  const rightAddress = right.stakerAddress.toLowerCase();
  return leftAddress < rightAddress ? -1 : leftAddress > rightAddress ? 1 : 0;
}

function campaignKey(keywordId: string, address: string) {
  return `${keywordId}\u0000${address.toLowerCase()}`;
}

export function selectEligibleAd(
  candidates: AdsKeywordCandidate[],
  positions: AdStakePosition[],
  campaigns: EligibleCampaign[],
) {
  const campaignByPosition = new Map(
    campaigns
      .filter(
        (campaign) =>
          !campaign.pausedAt && campaign.activeRevision?.status === AdCreativeStatus.APPROVED,
      )
      .map((campaign) => [
        campaignKey(adKeywordId(campaign.canonicalKeyword), campaign.user.address),
        campaign,
      ]),
  );
  const positionsByKeyword = new Map<string, AdStakePosition[]>();
  for (const position of positions) {
    if (!position.active || !position.eligible || rawStake(position.stakeRaw) <= 0n) continue;
    const group = positionsByKeyword.get(position.keywordId) ?? [];
    group.push(position);
    positionsByKeyword.set(position.keywordId, group);
  }
  for (const group of positionsByKeyword.values()) group.sort(compareAdStakePositions);

  for (const candidate of candidates) {
    const keywordId = adKeywordId(candidate.keyword);
    for (const position of positionsByKeyword.get(keywordId) ?? []) {
      const campaign = campaignByPosition.get(campaignKey(keywordId, position.stakerAddress));
      if (campaign?.activeRevision) return { candidate, position, campaign };
    }
  }
  return null;
}

function validatedCreative(input: AdCreativeInputDto) {
  let destination: URL;
  try {
    destination = new URL(input.destinationUrl);
  } catch {
    throw new BadRequestException('Destination must be a valid HTTPS URL');
  }
  if (
    destination.protocol !== 'https:' ||
    destination.username !== '' ||
    destination.password !== '' ||
    !destination.hostname
  ) {
    throw new BadRequestException('Destination must be an HTTPS URL without embedded credentials');
  }
  const destinationUrl = destination.toString();
  if (Array.from(destinationUrl).length > DESTINATION_URL_MAX_CHARACTERS) {
    throw new BadRequestException(
      `Destination must contain at most ${DESTINATION_URL_MAX_CHARACTERS} characters after URL normalization`,
    );
  }
  return {
    headline: input.headline.trim(),
    description: input.description.trim(),
    destinationUrl,
    displayDomain: destination.hostname,
  };
}

function normalizedKeyword(value: string) {
  try {
    return normalizeAdKeyword(value);
  } catch (error) {
    if (error instanceof AdsTextValidationError) throw new BadRequestException(error.message);
    throw error;
  }
}

function queryCandidates(value?: string) {
  if (typeof value !== 'string') throw new BadRequestException('Query parameter q is required');
  try {
    return adsKeywordCandidates(value);
  } catch (error) {
    if (error instanceof AdsTextValidationError) throw new BadRequestException(error.message);
    throw error;
  }
}

function dateThirtyDaysAgo(now = new Date()) {
  return new Date(now.getTime() - THIRTY_DAYS_MS);
}

function revisionView(revision: {
  id: string;
  version: number;
  headline: string;
  description: string;
  destinationUrl: string;
  displayDomain: string;
  status: AdCreativeStatus;
  moderationNote: string | null;
  lifetimeResolutions: bigint;
  createdAt: Date;
  dailyMetrics?: Array<{ resolutions: bigint }>;
}): AdRevisionView {
  return {
    id: revision.id,
    version: revision.version,
    headline: revision.headline,
    description: revision.description,
    destinationUrl: revision.destinationUrl,
    displayDomain: revision.displayDomain,
    status: revision.status,
    moderationNote: revision.moderationNote,
    createdAt: revision.createdAt.toISOString(),
    lifetimeResolutions: revision.lifetimeResolutions.toString(),
    last30DaysResolutions: (revision.dailyMetrics ?? [])
      .reduce((sum, metric) => sum + metric.resolutions, 0n)
      .toString(),
  };
}

@Injectable()
export class AdsService {
  private readonly resolverCache = new Map<
    string,
    { expiresAt: number; ad: AdResolveCreative | null }
  >();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdsMetricsService) private readonly metrics: AdsMetricsService,
    @Inject(ADS_CHAIN_ADAPTER) private readonly chain: AdsChainAdapter,
  ) {}

  private moderationConflict(): never {
    throw new ConflictException('The moderation state changed; reload and try again');
  }

  private assertModerationStateUnchanged(result: { count: number }) {
    if (result.count !== 1) this.moderationConflict();
  }

  chainSnapshot() {
    return this.chain.snapshot();
  }

  async apiKeys(): Promise<AdApiKeyView[]> {
    const keys = await this.prisma.adApiKey.findMany({
      select: API_KEY_METADATA_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(apiKeyView);
  }

  async createApiKey(
    body: CreateAdApiKeyDto,
    principal: AuthenticatedPrincipal,
  ): Promise<AdApiKeyCreateResponse> {
    const name = body.name.trim();
    if (!name || name.length > 80) {
      throw new BadRequestException('Key name must contain 1–80 characters');
    }
    const apiKey = `pkm_${randomBytes(32).toString('base64url')}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const key = await tx.adApiKey.create({
        data: {
          name,
          keyPrefix: apiKey.slice(0, 12),
          keyHash: hashAdApiKey(apiKey),
          createdByAddress: principal.address,
        },
        select: API_KEY_METADATA_SELECT,
      });
      const metadata = apiKeyView(key);
      await this.audit(tx, principal, key.id, 'AD_API_KEY_CREATE', null, metadata, 'AD_API_KEY');
      return metadata;
    });
    return { ...created, apiKey };
  }

  async revokeApiKey(id: string, principal: AuthenticatedPrincipal) {
    await this.prisma.$transaction(async (tx) => {
      const key = await tx.adApiKey.findUnique({ where: { id }, select: API_KEY_METADATA_SELECT });
      if (!key) throw new NotFoundException('API key not found');
      const revokedAt = new Date();
      const updated = await tx.adApiKey.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt },
      });
      if (updated.count) {
        await this.audit(
          tx,
          principal,
          id,
          'AD_API_KEY_REVOKE',
          apiKeyView(key),
          apiKeyView({ ...key, revokedAt }),
          'AD_API_KEY',
        );
      }
    });
  }

  async resolve(query?: string, countMetrics = true): Promise<AdResolveResponse> {
    const candidates = queryCandidates(query);
    const snapshot = await this.chain.snapshot();
    const cacheKey = createHash('sha256')
      .update(
        candidates.map((candidate) => `${candidate.startToken}:${candidate.keyword}`).join('|'),
      )
      .digest('hex');
    const now = Date.now();
    const cached = this.resolverCache.get(cacheKey);
    let ad: AdResolveCreative | null;
    if (cached && cached.expiresAt > now) {
      ad = cached.ad;
    } else {
      ad = snapshot.status === 'SYNCED' ? await this.resolveCandidates(candidates, snapshot) : null;
      this.cache(cacheKey, ad, now);
    }
    if (ad && countMetrics) {
      void this.metrics.increment(ad.revisionId);
      void this.metrics.incrementView(ad.revisionId);
    }
    return { requestId: randomUUID(), algorithmVersion: ADS_ALGORITHM_VERSION, ad };
  }

  async click(revisionId: string, countMetrics = true) {
    const revision = await this.prisma.adCreativeRevision.findFirst({
      where: {
        id: revisionId,
        OR: [
          { status: AdCreativeStatus.APPROVED },
          { status: AdCreativeStatus.SUPERSEDED, moderatedAt: { not: null } },
        ],
      },
      select: { destinationUrl: true },
    });
    if (!revision) throw new NotFoundException('Ad revision not found');
    if (countMetrics) await this.metrics.incrementClick(revisionId);
    return revision.destinationUrl;
  }

  private async resolveCandidates(
    candidates: AdsKeywordCandidate[],
    snapshot: AdsChainSnapshot,
  ): Promise<AdResolveCreative | null> {
    if (!snapshot.contractAddress) return null;
    const keywords = candidates.map((candidate) => candidate.keyword);
    const keywordIds = candidates.map((candidate) => adKeywordId(candidate.keyword));
    const positions = await this.prisma.adStakePosition.findMany({
      where: {
        chainId: snapshot.chainId,
        contractAddress: snapshot.contractAddress,
        keywordId: { in: keywordIds },
        active: true,
      },
    });
    if (!positions.length) return null;
    const addresses = [...new Set(positions.map((position) => position.stakerAddress))];
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        canonicalKeyword: { in: keywords },
        pausedAt: null,
        activeRevisionId: { not: null },
        user: { address: { in: addresses } },
      },
      include: { user: { select: { address: true } }, activeRevision: true },
    });
    const selected = selectEligibleAd(candidates, positions, campaigns);
    if (!selected?.campaign.activeRevision) return null;
    const indexedThroughBlock = await this.indexedThroughBlock(
      selected.position.chainId,
      selected.position.contractAddress,
    );
    return {
      revisionId: selected.campaign.activeRevision.id,
      headline: selected.campaign.activeRevision.headline,
      description: selected.campaign.activeRevision.description,
      destinationUrl: selected.campaign.activeRevision.destinationUrl,
      clickUrl: new URL(
        `/api/v1/keyword-market/revisions/${selected.campaign.activeRevision.id}/click`,
        config.WEB_ORIGIN,
      ).toString(),
      displayDomain: selected.campaign.activeRevision.displayDomain,
      matchedKeyword: selected.candidate.keyword,
      proof: this.proof(selected.position, indexedThroughBlock),
    };
  }

  async keyword(rawKeyword: string): Promise<AdKeywordResponse> {
    const keyword = normalizedKeyword(rawKeyword);
    const snapshot = await this.chain.snapshot();
    if (snapshot.status !== 'SYNCED' || !snapshot.contractAddress) {
      return {
        keyword,
        chainStatus: snapshot.status,
        chainId: snapshot.chainId,
        contractAddress: snapshot.contractAddress,
        indexedThroughBlock: null,
        positions: [],
      };
    }
    const positions = await this.prisma.adStakePosition.findMany({
      where: {
        chainId: snapshot.chainId,
        contractAddress: snapshot.contractAddress,
        keywordId: adKeywordId(keyword),
        active: true,
      },
    });
    positions.sort(compareAdStakePositions);
    const eligible = await this.eligibleCampaignKeys(positions, keyword);
    return {
      keyword,
      chainStatus: snapshot.status,
      chainId: snapshot.chainId,
      contractAddress: snapshot.contractAddress,
      indexedThroughBlock: await this.indexedThroughBlock(
        snapshot.chainId,
        snapshot.contractAddress,
      ),
      positions: positions.map((position, index) =>
        this.positionView(
          position,
          index + 1,
          eligible.has(campaignKey(adKeywordId(keyword), position.stakerAddress)),
        ),
      ),
    };
  }

  async mine(principal: AuthenticatedPrincipal): Promise<AdCampaignView[]> {
    const campaigns = await this.prisma.adCampaign.findMany({
      where: { userId: principal.userId },
      include: {
        revisions: {
          include: { dailyMetrics: { where: { day: { gte: dateThirtyDaysAgo() } } } },
          orderBy: { version: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const snapshot = await this.chain.snapshot();
    const keywords = campaigns.map((campaign) => campaign.canonicalKeyword);
    const keywordIds = keywords.map(adKeywordId);
    const positions =
      snapshot.contractAddress && keywords.length
        ? await this.prisma.adStakePosition.findMany({
            where: {
              chainId: snapshot.chainId,
              contractAddress: snapshot.contractAddress,
              keywordId: { in: keywordIds },
              active: true,
            },
          })
        : [];
    const positionsByKeyword = new Map<string, AdStakePosition[]>();
    for (const position of positions) {
      const group = positionsByKeyword.get(position.keywordId) ?? [];
      group.push(position);
      positionsByKeyword.set(position.keywordId, group);
    }
    for (const group of positionsByKeyword.values()) group.sort(compareAdStakePositions);

    return campaigns.map((campaign) => {
      const ranking = positionsByKeyword.get(adKeywordId(campaign.canonicalKeyword)) ?? [];
      const ownIndex = ranking.findIndex(
        (position) => position.stakerAddress === principal.address.toLowerCase(),
      );
      const own = ownIndex >= 0 ? ranking[ownIndex]! : null;
      const leader = ranking.find((position) => position.eligible) ?? null;
      const active = campaign.revisions.find(
        (revision) => revision.id === campaign.activeRevisionId,
      );
      const pending = campaign.revisions.find(
        (revision) => revision.status === AdCreativeStatus.PENDING_REVIEW,
      );
      const ownBid = own ? rawStake(own.bidUsdRaw) : 0n;
      const leaderBid = leader ? rawStake(leader.bidUsdRaw) : null;
      const targetBid = leader
        ? leaderBid! + (principal.address.toLowerCase() < leader.stakerAddress ? 0n : 1n)
        : null;
      return {
        id: campaign.id,
        keyword: campaign.canonicalKeyword,
        paused: Boolean(campaign.pausedAt),
        chainStatus: snapshot.status,
        position: own
          ? this.positionView(
              own,
              ownIndex + 1,
              !campaign.pausedAt && active?.status === AdCreativeStatus.APPROVED,
            )
          : null,
        leaderBidUsdRaw: leaderBid?.toString() ?? null,
        bidNeededToLeadUsdRaw:
          targetBid === null
            ? null
            : own?.eligible && own.stakerAddress === leader?.stakerAddress
              ? '0'
              : (targetBid > ownBid ? targetBid - ownBid : 0n).toString(),
        activeRevision: active ? revisionView(active) : null,
        pendingRevision: pending ? revisionView(pending) : null,
        lifetimeViews: campaign.revisions
          .reduce((sum, revision) => sum + revision.lifetimeViews, 0n)
          .toString(),
        lifetimeClicks: campaign.revisions
          .reduce((sum, revision) => sum + revision.lifetimeClicks, 0n)
          .toString(),
        revisions: campaign.revisions.map(revisionView),
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    });
  }

  async transaction(txHash: string, principal: AuthenticatedPrincipal) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new BadRequestException('Invalid transaction hash');
    }
    const snapshot = await this.chain.snapshot();
    const event =
      snapshot.status === 'SYNCED' &&
      snapshot.contractAddress &&
      snapshot.indexedThroughBlock !== null
        ? await this.prisma.adChainEvent.findFirst({
            where: {
              chainId: snapshot.chainId,
              contractAddress: snapshot.contractAddress,
              txHash: txHash.toLowerCase(),
              eventName: 'PositionChanged',
              blockNumber: { lte: BigInt(snapshot.indexedThroughBlock) },
              payload: { path: ['stakerAddress'], equals: principal.address.toLowerCase() },
            },
            select: { blockNumber: true, blockHash: true },
          })
        : null;
    return {
      chainStatus: snapshot.status,
      chainId: snapshot.chainId,
      contractAddress: snapshot.contractAddress,
      indexed: event !== null,
      blockNumber: event?.blockNumber.toString() ?? null,
      blockHash: event?.blockHash ?? null,
    };
  }

  async createCampaign(body: CreateAdCampaignDto, principal: AuthenticatedPrincipal) {
    const canonicalKeyword = normalizedKeyword(body.keyword);
    const creative = validatedCreative(body);
    try {
      const campaign = await this.prisma.adCampaign.create({
        data: {
          userId: principal.userId,
          canonicalKeyword,
          revisions: { create: { version: 1, ...creative } },
        },
        include: { revisions: true },
      });
      this.clearResolverCache();
      return {
        id: campaign.id,
        keyword: campaign.canonicalKeyword,
        revisionId: campaign.revisions[0]!.id,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This wallet already has a campaign for that keyword');
      }
      throw error;
    }
  }

  async createRevision(
    campaignId: string,
    body: AdCreativeInputDto,
    principal: AuthenticatedPrincipal,
  ) {
    const creative = validatedCreative(body);
    const revision = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.adCampaign.findFirst({
        where: { id: campaignId, userId: principal.userId },
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!campaign) throw new NotFoundException('Ad campaign not found');
      await tx.adCreativeRevision.updateMany({
        where: { campaignId, status: AdCreativeStatus.PENDING_REVIEW },
        data: { status: AdCreativeStatus.SUPERSEDED },
      });
      return tx.adCreativeRevision.create({
        data: {
          campaignId,
          version: (campaign.revisions[0]?.version ?? 0) + 1,
          ...creative,
        },
      });
    });
    this.clearResolverCache();
    return { revisionId: revision.id, version: revision.version };
  }

  async updateCampaign(campaignId: string, paused: boolean, principal: AuthenticatedPrincipal) {
    const updated = await this.prisma.adCampaign.updateMany({
      where: { id: campaignId, userId: principal.userId },
      data: { pausedAt: paused ? new Date() : null },
    });
    if (updated.count !== 1) throw new NotFoundException('Ad campaign not found');
    this.clearResolverCache();
    return { ok: true, paused };
  }

  async prepareStake(
    campaignId: string,
    amountRaw: string,
    bidUsdRaw: string,
    principal: AuthenticatedPrincipal,
  ) {
    const campaign = await this.ownedCampaign(campaignId, principal);
    return this.chain.stake({
      canonicalKeyword: campaign.canonicalKeyword,
      stakerAddress: principal.address,
      amountRaw,
      bidUsdRaw,
    });
  }

  async prepareRequestUnstake(campaignId: string, principal: AuthenticatedPrincipal) {
    const campaign = await this.ownedCampaign(campaignId, principal);
    return this.chain.requestUnstake({
      canonicalKeyword: campaign.canonicalKeyword,
      stakerAddress: principal.address,
    });
  }

  async prepareUnstake(campaignId: string, principal: AuthenticatedPrincipal) {
    const campaign = await this.ownedCampaign(campaignId, principal);
    return this.chain.unstake({
      canonicalKeyword: campaign.canonicalKeyword,
      stakerAddress: principal.address,
    });
  }

  private async ownedCampaign(campaignId: string, principal: AuthenticatedPrincipal) {
    const campaign = await this.prisma.adCampaign.findFirst({
      where: { id: campaignId, userId: principal.userId },
      select: { canonicalKeyword: true },
    });
    if (!campaign) throw new NotFoundException('Ad campaign not found');
    return campaign;
  }

  async report(revisionId: string, body: ReportAdDto, ip: string) {
    const dayValue = adsUtcDay();
    const fingerprintDay = new Date(`${dayValue}T00:00:00.000Z`);
    const reporterFingerprint = createHmac('sha256', config.ADS_REPORT_FINGERPRINT_SECRET)
      .update(`${dayValue}:${ip}`)
      .digest('hex');
    await this.prisma.$transaction(async (tx) => {
      const revision = await tx.adCreativeRevision.findUnique({
        where: { id: revisionId },
        select: { id: true },
      });
      if (!revision) return;
      const inserted = await tx.adReport.createMany({
        data: [
          {
            revisionId,
            reason: body.reason,
            comment: body.comment || null,
            reporterFingerprint,
            fingerprintDay,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count !== 1) return;
      await tx.adReportAggregate.upsert({
        where: { revisionId_reason: { revisionId, reason: body.reason } },
        update: { total: { increment: 1 } },
        create: { revisionId, reason: body.reason, total: 1 },
      });
    });
    return { accepted: true };
  }

  async adminRevisions(status?: AdCreativeStatus): Promise<AdAdminRevisionView[]> {
    const revisions = await this.prisma.adCreativeRevision.findMany({
      where: status ? { status } : undefined,
      include: {
        campaign: { include: { user: { select: { address: true } } } },
        dailyMetrics: { where: { day: { gte: dateThirtyDaysAgo() } } },
        reportAggregates: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(
      revisions.map(async (revision) => ({
        ...revisionView(revision),
        canSuspend: canSuspendRevision(revision),
        keyword: revision.campaign.canonicalKeyword,
        advertiserAddress: revision.campaign.user.address,
        reportCount: revision.reportAggregates
          .reduce((sum, aggregate) => sum + aggregate.total, 0n)
          .toString(),
        proof: await this.proofForCampaign(
          revision.campaign.canonicalKeyword,
          revision.campaign.user.address,
        ),
      })),
    );
  }

  async adminReports(
    status: AdReportStatus = AdReportStatus.OPEN,
    cursor?: string,
    limit = 25,
  ): Promise<AdAdminReportPage> {
    const revisions = await this.prisma.adCreativeRevision.findMany({
      where: { reports: { some: { status } } },
      include: {
        campaign: { include: { user: { select: { address: true } } } },
        dailyMetrics: { where: { day: { gte: dateThirtyDaysAgo() } } },
        reportAggregates: true,
        reports: {
          where: { status },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: ADMIN_REPORT_PREVIEW_LIMIT,
        },
        _count: { select: { reports: { where: { status } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = revisions.length > limit;
    const page = revisions.slice(0, limit);
    const items: AdAdminReportGroup[] = await Promise.all(
      page.map(async (revision) => {
        return {
          revision: {
            ...revisionView(revision),
            canSuspend: canSuspendRevision(revision),
            keyword: revision.campaign.canonicalKeyword,
            advertiserAddress: revision.campaign.user.address,
            reportCount: revision.reportAggregates
              .reduce((sum, aggregate) => sum + aggregate.total, 0n)
              .toString(),
            proof: await this.proofForCampaign(
              revision.campaign.canonicalKeyword,
              revision.campaign.user.address,
            ),
          },
          reports: revision.reports.map((report) => ({
            id: report.id,
            reason: report.reason,
            comment: report.comment,
            createdAt: report.createdAt.toISOString(),
          })),
          matchingReportCount: revision._count.reports.toString(),
          reportsTruncated: revision._count.reports > revision.reports.length,
        };
      }),
    );
    return { items, nextCursor: hasMore ? page.at(-1)!.id : null };
  }

  async adminAudit() {
    const events = await this.prisma.auditEvent.findMany({
      where: { entityType: 'AD_CREATIVE_REVISION' },
      orderBy: { createdAt: 'desc' },
    });
    return events.map((event) => ({
      id: event.id,
      actorAddress: event.actorAddress,
      entityId: event.entityId,
      action: event.action,
      before: event.before,
      after: event.after,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async moderateRevision(
    revisionId: string,
    action: AdModerationAction,
    note: string | undefined,
    principal: AuthenticatedPrincipal,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const revision = await tx.adCreativeRevision.findUnique({
        where: { id: revisionId },
        include: { campaign: true },
      });
      if (!revision) throw new NotFoundException('Ad revision not found');
      const before = {
        status: revision.status,
        activeRevisionId: revision.campaign.activeRevisionId,
      };
      const moderation = {
        moderatedByAddress: principal.address,
        moderationNote: note || null,
        moderatedAt: new Date(),
      };
      if (action === AdModerationAction.APPROVE) {
        if (revision.status !== AdCreativeStatus.PENDING_REVIEW)
          throw new ConflictException('Only a pending revision can be approved');
        if (revision.campaign.activeRevisionId) {
          const superseded = await tx.adCreativeRevision.updateMany({
            where: {
              id: revision.campaign.activeRevisionId,
              status: AdCreativeStatus.APPROVED,
            },
            data: { status: AdCreativeStatus.SUPERSEDED },
          });
          this.assertModerationStateUnchanged(superseded);
        }
        const approved = await tx.adCreativeRevision.updateMany({
          where: { id: revisionId, status: AdCreativeStatus.PENDING_REVIEW },
          data: { status: AdCreativeStatus.APPROVED, ...moderation },
        });
        this.assertModerationStateUnchanged(approved);
        const activated = await tx.adCampaign.updateMany({
          where: {
            id: revision.campaignId,
            activeRevisionId: revision.campaign.activeRevisionId,
          },
          data: { activeRevisionId: revisionId },
        });
        this.assertModerationStateUnchanged(activated);
      } else if (action === AdModerationAction.REJECT) {
        if (revision.status !== AdCreativeStatus.PENDING_REVIEW)
          throw new ConflictException('Only a pending revision can be rejected');
        const rejected = await tx.adCreativeRevision.updateMany({
          where: { id: revisionId, status: AdCreativeStatus.PENDING_REVIEW },
          data: { status: AdCreativeStatus.REJECTED, ...moderation },
        });
        this.assertModerationStateUnchanged(rejected);
      } else if (action === AdModerationAction.SUSPEND) {
        if (!canSuspendRevision(revision))
          throw new ConflictException('Only a published revision can be suspended');
        const suspended = await tx.adCreativeRevision.updateMany({
          where: {
            id: revisionId,
            status: revision.status,
            ...(revision.status === AdCreativeStatus.SUPERSEDED
              ? { moderatedAt: { not: null } }
              : {}),
          },
          data: { status: AdCreativeStatus.SUSPENDED, ...moderation },
        });
        this.assertModerationStateUnchanged(suspended);
        if (revision.campaign.activeRevisionId === revisionId) {
          const deactivated = await tx.adCampaign.updateMany({
            where: { id: revision.campaignId, activeRevisionId: revisionId },
            data: { activeRevisionId: null },
          });
          this.assertModerationStateUnchanged(deactivated);
        }
      } else {
        if (revision.status !== AdCreativeStatus.SUSPENDED)
          throw new ConflictException('Only a suspended revision can be restored');
        if (revision.campaign.activeRevisionId)
          throw new ConflictException('A newer approved revision is already active');
        const restored = await tx.adCreativeRevision.updateMany({
          where: { id: revisionId, status: AdCreativeStatus.SUSPENDED },
          data: { status: AdCreativeStatus.APPROVED, ...moderation },
        });
        this.assertModerationStateUnchanged(restored);
        const reactivated = await tx.adCampaign.updateMany({
          where: { id: revision.campaignId, activeRevisionId: null },
          data: { activeRevisionId: revisionId },
        });
        this.assertModerationStateUnchanged(reactivated);
      }
      await this.audit(tx, principal, revisionId, `AD_REVISION_${action}`, before, {
        status:
          action === AdModerationAction.APPROVE || action === AdModerationAction.RESTORE
            ? AdCreativeStatus.APPROVED
            : action === AdModerationAction.REJECT
              ? AdCreativeStatus.REJECTED
              : AdCreativeStatus.SUSPENDED,
        note: note || null,
      });
    });
    this.clearResolverCache();
    return { ok: true };
  }

  async resolveReports(
    revisionId: string,
    action: AdReportResolutionAction,
    note: string | undefined,
    principal: AuthenticatedPrincipal,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const revision = await tx.adCreativeRevision.findUnique({
        where: { id: revisionId },
        include: { campaign: true },
      });
      if (!revision) throw new NotFoundException('Ad revision not found');
      const openReports = await tx.adReport.count({
        where: { revisionId, status: AdReportStatus.OPEN },
      });
      if (!openReports) throw new ConflictException('This revision has no open reports');
      const resolvedAt = new Date();
      if (action === AdReportResolutionAction.SUSPEND_AD) {
        if (canSuspendRevision(revision)) {
          const suspended = await tx.adCreativeRevision.updateMany({
            where: {
              id: revisionId,
              status: revision.status,
              ...(revision.status === AdCreativeStatus.SUPERSEDED
                ? { moderatedAt: { not: null } }
                : {}),
            },
            data: {
              status: AdCreativeStatus.SUSPENDED,
              moderatedByAddress: principal.address,
              moderationNote: note || null,
              moderatedAt: resolvedAt,
            },
          });
          this.assertModerationStateUnchanged(suspended);
        }
        if (revision.campaign.activeRevisionId === revisionId) {
          const deactivated = await tx.adCampaign.updateMany({
            where: { id: revision.campaignId, activeRevisionId: revisionId },
            data: { activeRevisionId: null },
          });
          this.assertModerationStateUnchanged(deactivated);
        }
      }
      const resolved = await tx.adReport.updateMany({
        where: { revisionId, status: AdReportStatus.OPEN },
        data: {
          status:
            action === AdReportResolutionAction.DISMISS
              ? AdReportStatus.DISMISSED
              : AdReportStatus.ACTIONED,
          resolvedByAddress: principal.address,
          resolutionNote: note || null,
          resolvedAt,
        },
      });
      if (resolved.count === 0) this.moderationConflict();
      await this.audit(
        tx,
        principal,
        revisionId,
        `AD_REPORTS_${action}`,
        { openReports },
        {
          resolvedReports: resolved.count,
          note: note || null,
        },
      );
    });
    this.clearResolverCache();
    return { ok: true };
  }

  private async eligibleCampaignKeys(positions: AdStakePosition[], keyword: string) {
    if (!positions.length) return new Set<string>();
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        canonicalKeyword: keyword,
        pausedAt: null,
        activeRevision: { status: AdCreativeStatus.APPROVED },
        user: { address: { in: [...new Set(positions.map((item) => item.stakerAddress))] } },
      },
      include: { user: { select: { address: true } } },
    });
    return new Set(
      campaigns.map((campaign) =>
        campaignKey(adKeywordId(campaign.canonicalKeyword), campaign.user.address),
      ),
    );
  }

  private positionView(
    position: AdStakePosition,
    rank: number,
    hasEligibleAd: boolean,
  ): AdKeywordPositionView {
    return {
      rank,
      stakerAddress: position.stakerAddress,
      stakeRaw: position.stakeRaw,
      bidUsdRaw: position.bidUsdRaw,
      requiredCoveragePreRaw: position.requiredCoveragePreRaw,
      eligible: position.eligible,
      withdrawAvailableAt: position.withdrawAvailableAt.toString(),
      positionVersion: position.positionVersion.toString(),
      amountSinceBlock: position.amountSinceBlock.toString(),
      amountSinceLogIndex: position.amountSinceLogIndex,
      positionBlock: position.positionBlock.toString(),
      positionTxHash: position.positionTxHash,
      hasEligibleAd,
    };
  }

  private proof(position: AdStakePosition, indexedThroughBlock: string | null) {
    return {
      chainId: position.chainId,
      contractAddress: position.contractAddress,
      stakerAddress: position.stakerAddress,
      stakeRaw: position.stakeRaw,
      bidUsdRaw: position.bidUsdRaw,
      requiredCoveragePreRaw: position.requiredCoveragePreRaw,
      eligible: position.eligible,
      withdrawAvailableAt: position.withdrawAvailableAt.toString(),
      positionVersion: position.positionVersion.toString(),
      positionBlock: position.positionBlock.toString(),
      positionTxHash: position.positionTxHash,
      indexedThroughBlock,
    };
  }

  private async proofForCampaign(keyword: string, address: string) {
    const snapshot = await this.chain.snapshot();
    if (snapshot.status !== 'SYNCED' || !snapshot.contractAddress) return null;
    const position = await this.prisma.adStakePosition.findUnique({
      where: {
        chainId_contractAddress_keywordId_stakerAddress: {
          chainId: snapshot.chainId,
          contractAddress: snapshot.contractAddress,
          keywordId: adKeywordId(keyword),
          stakerAddress: address.toLowerCase(),
        },
      },
    });
    if (!position?.active || !position.eligible || rawStake(position.stakeRaw) <= 0n) return null;
    return this.proof(
      position,
      await this.indexedThroughBlock(position.chainId, position.contractAddress),
    );
  }

  private async indexedThroughBlock(chainId: number, contractAddress: string) {
    const state = await this.prisma.adIndexerState.findFirst({
      where: { chainId, contractAddress },
      orderBy: { updatedAt: 'desc' },
      select: { lastBlockNumber: true },
    });
    return state?.lastBlockNumber.toString() ?? null;
  }

  private cache(key: string, ad: AdResolveCreative | null, now: number) {
    if (this.resolverCache.size >= RESOLVER_CACHE_MAX) {
      for (const [candidate, entry] of this.resolverCache) {
        if (entry.expiresAt <= now) this.resolverCache.delete(candidate);
      }
      if (this.resolverCache.size >= RESOLVER_CACHE_MAX) {
        this.resolverCache.delete(this.resolverCache.keys().next().value!);
      }
    }
    this.resolverCache.set(key, { ad, expiresAt: now + RESOLVER_CACHE_MS });
  }

  private clearResolverCache() {
    this.resolverCache.clear();
  }

  private async audit(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    entityType = 'AD_CREATIVE_REVISION',
  ) {
    const project = await tx.project.findUnique({
      where: { slug: PROJECT_SLUG },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Application project is not configured');
    await writeAuditEvent(tx, {
      projectId: project.id,
      actor: principal,
      entityType,
      entityId,
      action,
      before,
      after,
    });
  }
}
