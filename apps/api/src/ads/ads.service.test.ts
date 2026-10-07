import {
  AdCreativeStatus,
  AdReportReason,
  AdReportStatus,
  Role,
  type AdStakePosition,
} from '@precommunity/database';
import { adKeywordId, adsKeywordCandidates } from '@precommunity/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdsService, compareAdStakePositions, selectEligibleAd } from './ads.service';
import { AdModerationAction, AdReportResolutionAction } from './ads.dto';

const address = (suffix: string) => `0x${suffix.padStart(40, '0')}`;

function position(
  keyword: string,
  staker: string,
  stakeRaw: string,
  amountSinceBlock = 100n,
  amountSinceLogIndex = 0,
): AdStakePosition {
  return {
    id: `${keyword}-${staker}`,
    chainId: 8453,
    contractAddress: address('99'),
    keywordId: adKeywordId(keyword),
    stakerAddress: staker,
    stakeRaw,
    bidUsdRaw: stakeRaw,
    requiredCoveragePreRaw: '1',
    eligible: true,
    withdrawAvailableAt: 0n,
    positionVersion: 1n,
    amountSinceBlock,
    amountSinceLogIndex,
    positionBlock: amountSinceBlock,
    positionBlockHash: `0x${'1'.repeat(64)}`,
    positionTxHash: `0x${'2'.repeat(64)}`,
    positionLogIndex: amountSinceLogIndex,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function campaign(
  keyword: string,
  staker: string,
  status: AdCreativeStatus = AdCreativeStatus.APPROVED,
) {
  return {
    canonicalKeyword: keyword,
    pausedAt: null,
    user: { address: staker },
    activeRevision: {
      id: `${keyword}-${staker}-creative`,
      headline: 'Result headline',
      description: 'Result description',
      destinationUrl: 'https://example.com/',
      displayDomain: 'example.com',
      status,
    },
  };
}

describe('PRE Keyword Market stake ordering', () => {
  it('uses eligibility, bid USD, then address, independent of PRE amount or event order', () => {
    const later = position('bitcoin', address('3'), '100', 101n, 0);
    const earlierLog = position('bitcoin', address('2'), '100', 100n, 2);
    const earliestLog = position('bitcoin', address('4'), '100', 100n, 1);
    const largest = position('bitcoin', address('5'), '101', 500n, 8);
    earliestLog.eligible = false;

    expect([later, earlierLog, earliestLog, largest].sort(compareAdStakePositions)).toEqual([
      largest,
      earlierLog,
      later,
      earliestLog,
    ]);
    expect(
      [position('bitcoin', address('2'), '100'), position('bitcoin', address('1'), '100')]
        .sort(compareAdStakePositions)
        .map((item) => item.stakerAddress),
    ).toEqual([address('1'), address('2')]);
  });
});

describe('PRE Keyword Market resolver eligibility', () => {
  const longLeader = address('1');
  const longRunnerUp = address('2');
  const shortLeader = address('3');
  const positions = [
    position('bitcoin poland', longLeader, '500'),
    position('bitcoin poland', longRunnerUp, '400'),
    position('bitcoin', shortLeader, '1000'),
  ];

  it('tries the next eligible staker before falling back to a shorter keyword', () => {
    const selected = selectEligibleAd(adsKeywordCandidates('bitcoin poland xyz'), positions, [
      campaign('bitcoin poland', longLeader, AdCreativeStatus.SUSPENDED),
      campaign('bitcoin poland', longRunnerUp),
      campaign('bitcoin', shortLeader),
    ]);

    expect(selected?.candidate.keyword).toBe('bitcoin poland');
    expect(selected?.position.stakerAddress).toBe(longRunnerUp);
  });

  it('falls back to the shorter eligible keyword when the longer market has no active ad', () => {
    const selected = selectEligibleAd(adsKeywordCandidates('bitcoin poland xyz'), positions, [
      campaign('bitcoin', shortLeader),
    ]);

    expect(selected?.candidate.keyword).toBe('bitcoin');
    expect(selected?.position.stakerAddress).toBe(shortLeader);
  });

  it('returns no ad when every matching position lacks an approved active creative', () => {
    expect(selectEligibleAd(adsKeywordCandidates('bitcoin price'), positions, [])).toBeNull();
  });

  it('ignores the highest bid once charging makes it ineligible', () => {
    const ineligible = position('bitcoin poland', longLeader, '900');
    ineligible.eligible = false;
    const selected = selectEligibleAd(
      adsKeywordCandidates('bitcoin poland'),
      [ineligible, position('bitcoin poland', longRunnerUp, '400')],
      [campaign('bitcoin poland', longLeader), campaign('bitcoin poland', longRunnerUp)],
    );
    expect(selected?.position.stakerAddress).toBe(longRunnerUp);
  });
});

describe('PRE Keyword Market public resolve response', () => {
  it('does not count an empty or invalid query response as a view', async () => {
    const metrics = { increment: vi.fn(), incrementView: vi.fn() };
    const service = new AdsService({} as never, metrics as never, { snapshot: () => ({ status: 'AWAITING_CONTRACT' }) } as never);
    await expect(service.resolve('bitcoin')).resolves.toMatchObject({ ad: null });
    await expect(service.resolve('---')).rejects.toThrow();
    expect(metrics.incrementView).not.toHaveBeenCalled();
    expect(metrics.increment).not.toHaveBeenCalled();
  });
  it('returns creative fields with a verifiable chain/indexer proof', async () => {
    const staker = address('7');
    const winner = position('bitcoin', staker, '900', 88n, 2);
    const metrics = { increment: vi.fn().mockResolvedValue(true), incrementView: vi.fn().mockResolvedValue(true) };
    const prisma = {
      adStakePosition: { findMany: vi.fn().mockResolvedValue([winner]) },
      adCampaign: { findMany: vi.fn().mockResolvedValue([campaign('bitcoin', staker)]) },
      adIndexerState: { findFirst: vi.fn().mockResolvedValue({ lastBlockNumber: 120n }) },
    };
    const chain = {
      snapshot: () => ({
        status: 'SYNCED',
        chainId: 8453,
        contractAddress: address('99'),
        deploymentBlock: '1',
        transactionsEnabled: true,
      }),
    };
    const service = new AdsService(prisma as never, metrics as never, chain as never);

    const response = await service.resolve('BITCOIN price');

    expect(response).toEqual({
      requestId: expect.any(String),
      algorithmVersion: 'keyword-longest-v2',
      ad: expect.objectContaining({
        matchedKeyword: 'bitcoin',
        revisionId: 'bitcoin-0x0000000000000000000000000000000000000007-creative',
        proof: {
          chainId: 8453,
          contractAddress: address('99'),
          stakerAddress: staker,
          stakeRaw: '900',
          bidUsdRaw: '900',
          requiredCoveragePreRaw: '1',
          eligible: true,
          withdrawAvailableAt: '0',
          positionVersion: '1',
          positionBlock: '88',
          positionTxHash: winner.positionTxHash,
          indexedThroughBlock: '120',
        },
      }),
    });
    expect(metrics.increment).toHaveBeenCalledWith(response.ad!.revisionId);
    expect(metrics.incrementView).toHaveBeenCalledWith(response.ad!.revisionId);
    expect(response.ad!.clickUrl).toContain(`/v1/keyword-market/revisions/${response.ad!.revisionId}/click`);
    expect(new URL(response.ad!.clickUrl).pathname).toBe(`/api/v1/keyword-market/revisions/${response.ad!.revisionId}/click`);

    await service.resolve('BITCOIN price');
    expect(prisma.adCampaign.findMany).toHaveBeenCalledOnce();
    expect(metrics.incrementView).toHaveBeenCalledTimes(2);
    await service.resolve('BITCOIN price', false);
    expect(metrics.incrementView).toHaveBeenCalledTimes(2);
  });
});

describe('PRE Keyword Market campaign market view', () => {
  it('sums lifetime views and clicks across current and older revisions without losing integer precision', async () => {
    const now = new Date(0);
    const revision = {
      ...campaign('bitcoin', address('3')).activeRevision,
      version: 1, moderationNote: null, createdAt: now, lifetimeResolutions: 0n, dailyMetrics: [],
    };
    const prisma = {
      adCampaign: { findMany: vi.fn().mockResolvedValue([{
        id: 'campaign-1', canonicalKeyword: 'bitcoin', pausedAt: null, activeRevisionId: 'current',
        revisions: [
          { ...revision, id: 'current', lifetimeViews: 9007199254740995n, lifetimeClicks: 2n },
          { ...revision, id: 'older', status: AdCreativeStatus.SUPERSEDED, lifetimeViews: 5n, lifetimeClicks: 3n },
        ],
        createdAt: now, updatedAt: now,
      }]) },
    };
    const service = new AdsService(prisma as never, {} as never, { snapshot: () => ({ status: 'AWAITING_CONTRACT', contractAddress: null }) } as never);
    await expect(service.mine({ userId: 'user-1', address: address('3') } as never)).resolves.toEqual([
      expect.objectContaining({ lifetimeViews: '9007199254741000', lifetimeClicks: '5' }),
    ]);
  });
  it('reports bid ranking and keeps a pending withdrawal visible to its owner', async () => {
    const owner = address('3');
    const leader = position('bitcoin', address('1'), '100');
    const withdrawing = position('bitcoin', owner, '500');
    withdrawing.bidUsdRaw = '90';
    withdrawing.eligible = false;
    withdrawing.withdrawAvailableAt = 1_700_000_000n;
    const now = new Date(0);
    const prisma = {
      adCampaign: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'campaign-1',
            canonicalKeyword: 'bitcoin',
            pausedAt: null,
            activeRevisionId: null,
            revisions: [],
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      adStakePosition: { findMany: vi.fn().mockResolvedValue([withdrawing, leader]) },
    };
    const chain = {
      snapshot: vi.fn().mockResolvedValue({
        status: 'SYNCING',
        chainId: 8453,
        contractAddress: address('99'),
      }),
    };
    const service = new AdsService(prisma as never, {} as never, chain as never);
    const result = await service.mine({ userId: 'user-1', address: owner } as never);
    expect(result[0]).toMatchObject({
      chainStatus: 'SYNCING',
      leaderBidUsdRaw: '100',
      bidNeededToLeadUsdRaw: '11',
      position: {
        rank: 2,
        stakeRaw: '500',
        bidUsdRaw: '90',
        eligible: false,
        withdrawAvailableAt: '1700000000',
        positionVersion: '1',
      },
    });
  });
});

describe('PRE Keyword Market anonymous report storage', () => {
  it('deduplicates by a one-way daily fingerprint and never writes the raw IP', async () => {
    const aggregateUpsert = vi.fn();
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        adCreativeRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'revision-1' }) },
        adReport: { createMany },
        adReportAggregate: { upsert: aggregateUpsert },
      }),
    );
    const service = new AdsService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
    );
    const rawIp = '203.0.113.42';

    await expect(
      service.report('revision-1', { reason: AdReportReason.OTHER }, rawIp),
    ).resolves.toEqual({ accepted: true });

    const stored = createMany.mock.calls[0]![0];
    expect(JSON.stringify(stored)).not.toContain(rawIp);
    expect(stored).toEqual({
      data: [
        expect.objectContaining({
          revisionId: 'revision-1',
          reason: AdReportReason.OTHER,
          reporterFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
      skipDuplicates: true,
    });
    expect(aggregateUpsert).toHaveBeenCalledOnce();
  });

  it('keeps duplicate intake generic without incrementing aggregates twice', async () => {
    const aggregateUpsert = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        adCreativeRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'revision-1' }) },
        adReport: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        adReportAggregate: { upsert: aggregateUpsert },
      }),
    );
    const service = new AdsService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.report('revision-1', { reason: AdReportReason.MISLEADING }, '203.0.113.42'),
    ).resolves.toEqual({ accepted: true });
    expect(aggregateUpsert).not.toHaveBeenCalled();
  });
});

describe('PRE Keyword Market campaign authorization and version switching', () => {
  const principal = {
    userId: 'user-1',
    address: address('1'),
    roles: [Role.CONTENT_ADMIN],
    chainAuthorities: [],
    chainOwnerAddress: null,
    safeOwner: false,
    canAccessSafeOwnershipAcceptance: false,
    safeAddress: null,
  };

  it('scopes pause/resume updates to the authenticated campaign owner', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new AdsService(
      { adCampaign: { updateMany } } as never,
      {} as never,
      {} as never,
    );

    await expect(service.updateCampaign('campaign-1', true, principal)).rejects.toThrow(
      'Ad campaign not found',
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', userId: principal.userId },
      data: { pausedAt: expect.any(Date) },
    });
  });

  it('prepares stake calldata only from a campaign owned by the signed-in wallet', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ canonicalKeyword: 'bitcoin poland' })
      .mockResolvedValueOnce(null);
    const stake = vi.fn().mockResolvedValue({ status: 'READY' });
    const service = new AdsService(
      { adCampaign: { findFirst } } as never,
      {} as never,
      { stake } as never,
    );

    await expect(
      service.prepareStake('campaign-owned', '100', '2000000', principal),
    ).resolves.toEqual({
      status: 'READY',
    });
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'campaign-owned', userId: principal.userId },
      select: { canonicalKeyword: true },
    });
    expect(stake).toHaveBeenCalledWith({
      canonicalKeyword: 'bitcoin poland',
      stakerAddress: principal.address,
      amountRaw: '100',
      bidUsdRaw: '2000000',
    });

    await expect(
      service.prepareStake('campaign-other-wallet', '100', '2000000', principal),
    ).rejects.toThrow('Ad campaign not found');
    expect(stake).toHaveBeenCalledOnce();
  });

  it('rejects HTTPS destinations that embed credentials before writing a campaign', async () => {
    const create = vi.fn();
    const service = new AdsService({ adCampaign: { create } } as never, {} as never, {} as never);

    await expect(
      service.createCampaign(
        {
          keyword: 'bitcoin',
          headline: 'Result',
          description: 'A useful destination.',
          destinationUrl: 'https://user:password@example.com/result',
        },
        principal,
      ),
    ).rejects.toThrow('without embedded credentials');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a destination that exceeds the limit after URL normalization', async () => {
    const create = vi.fn();
    const service = new AdsService({ adCampaign: { create } } as never, {} as never, {} as never);

    await expect(
      service.createCampaign(
        {
          keyword: 'bitcoin',
          headline: 'Result',
          description: 'A useful destination.',
          destinationUrl: `https://example.com/${'ą'.repeat(400)}`,
        },
        principal,
      ),
    ).rejects.toThrow('after URL normalization');
    expect(create).not.toHaveBeenCalled();
  });

  it('paginates report groups by revision without letting one noisy revision hide the rest', async () => {
    const createdAt = new Date('2026-08-24T12:30:00.000Z');
    const revision = (id: string, reportCount: number) => ({
      id,
      version: 1,
      headline: 'Result',
      description: 'A useful destination.',
      destinationUrl: 'https://example.com/',
      displayDomain: 'example.com',
      status: AdCreativeStatus.APPROVED,
      moderationNote: null,
      lifetimeResolutions: 4n,
      createdAt,
      dailyMetrics: [{ resolutions: 2n }],
      reportAggregates: [{ total: BigInt(reportCount) }],
      campaign: {
        canonicalKeyword: 'bitcoin',
        user: { address: principal.address },
      },
      reports: [
        {
          id: `report-${id}`,
          reason: AdReportReason.MISLEADING,
          comment: null,
          createdAt,
        },
      ],
      _count: { reports: reportCount },
    });
    const findMany = vi
      .fn()
      .mockResolvedValue([
        revision('revision-1', 500),
        revision('revision-2', 1),
        revision('revision-3', 1),
      ]);
    const service = new AdsService(
      { adCreativeRevision: { findMany } } as never,
      {} as never,
      { snapshot: () => ({ status: 'AWAITING_CONTRACT' }) } as never,
    );

    await expect(service.adminReports(AdReportStatus.OPEN, 'revision-cursor', 2)).resolves.toEqual({
      items: [
        expect.objectContaining({ matchingReportCount: '500', reportsTruncated: true }),
        expect.objectContaining({ matchingReportCount: '1', reportsTruncated: false }),
      ],
      nextCursor: 'revision-2',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reports: { some: { status: AdReportStatus.OPEN } } },
        cursor: { id: 'revision-cursor' },
        skip: 1,
        take: 3,
        include: expect.objectContaining({
          reports: expect.objectContaining({ take: 25 }),
          _count: { select: { reports: { where: { status: AdReportStatus.OPEN } } } },
        }),
      }),
    );
  });

  it('atomically supersedes the old creative when a pending revision is approved', async () => {
    const revisionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const campaignUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      adCreativeRevision: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'revision-2',
          campaignId: 'campaign-1',
          status: AdCreativeStatus.PENDING_REVIEW,
          campaign: { id: 'campaign-1', activeRevisionId: 'revision-1' },
        }),
        updateMany: revisionUpdateMany,
      },
      adCampaign: { updateMany: campaignUpdateMany },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
      auditEvent: { create: auditCreate },
    };
    const service = new AdsService(
      { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as never,
      {} as never,
      {} as never,
    );

    await service.moderateRevision(
      'revision-2',
      AdModerationAction.APPROVE,
      'Reviewed destination',
      principal,
    );

    expect(revisionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'revision-1', status: AdCreativeStatus.APPROVED },
      data: { status: AdCreativeStatus.SUPERSEDED },
    });
    expect(revisionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'revision-2', status: AdCreativeStatus.PENDING_REVIEW },
      data: expect.objectContaining({
        status: AdCreativeStatus.APPROVED,
        moderatedByAddress: principal.address,
        moderationNote: 'Reviewed destination',
      }),
    });
    expect(campaignUpdateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', activeRevisionId: 'revision-1' },
      data: { activeRevisionId: 'revision-2' },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'AD_REVISION_APPROVE', entityId: 'revision-2' }),
    });
  });

  it('does not clear a newer active revision when suspension loses a moderation race', async () => {
    const campaignUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const auditCreate = vi.fn();
    const tx = {
      adCreativeRevision: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'revision-1',
          campaignId: 'campaign-1',
          status: AdCreativeStatus.APPROVED,
          campaign: { id: 'campaign-1', activeRevisionId: 'revision-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      adCampaign: { updateMany: campaignUpdateMany },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
      auditEvent: { create: auditCreate },
    };
    const service = new AdsService(
      { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.moderateRevision(
        'revision-1',
        AdModerationAction.SUSPEND,
        'Policy violation',
        principal,
      ),
    ).rejects.toThrow('moderation state changed');
    expect(campaignUpdateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', activeRevisionId: 'revision-1' },
      data: { activeRevisionId: null },
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('does not clear a newer active revision while suspending reported creative', async () => {
    const reportUpdateMany = vi.fn();
    const campaignUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      adCreativeRevision: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'revision-1',
          campaignId: 'campaign-1',
          status: AdCreativeStatus.APPROVED,
          campaign: { id: 'campaign-1', activeRevisionId: 'revision-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      adCampaign: { updateMany: campaignUpdateMany },
      adReport: {
        count: vi.fn().mockResolvedValue(1),
        updateMany: reportUpdateMany,
      },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
      auditEvent: { create: vi.fn() },
    };
    const service = new AdsService(
      { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.resolveReports(
        'revision-1',
        AdReportResolutionAction.SUSPEND_AD,
        'Confirmed abuse',
        principal,
      ),
    ).rejects.toThrow('moderation state changed');
    expect(campaignUpdateMany).toHaveBeenCalledWith({
      where: { id: 'campaign-1', activeRevisionId: 'revision-1' },
      data: { activeRevisionId: null },
    });
    expect(reportUpdateMany).not.toHaveBeenCalled();
  });

  it('returns the ads-only moderation audit trail with recorded transitions', async () => {
    const createdAt = new Date('2026-08-24T12:30:00.000Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'audit-1',
        actorAddress: principal.address,
        entityId: 'revision-2',
        action: 'AD_REVISION_APPROVE',
        before: { status: 'PENDING_REVIEW' },
        after: { status: 'APPROVED' },
        createdAt,
      },
    ]);
    const service = new AdsService({ auditEvent: { findMany } } as never, {} as never, {} as never);

    await expect(service.adminAudit()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit-1',
        actorAddress: principal.address,
        action: 'AD_REVISION_APPROVE',
        createdAt: createdAt.toISOString(),
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { entityType: 'AD_CREATIVE_REVISION' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PRE Keyword Market finalized transaction proof', () => {
  it('proves only the authenticated wallet transaction and disappears after a reorg reset', async () => {
    const txHash = `0x${'AB'.repeat(32)}`;
    const principal = { userId: 'user-1', address: address('1').toUpperCase().replace('0X', '0x') };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ blockNumber: 110n, blockHash: `0x${'33'.repeat(32)}` })
      .mockResolvedValue(null);
    const snapshot = {
      status: 'SYNCED',
      chainId: 84532,
      contractAddress: address('99'),
      indexedThroughBlock: '120',
    };
    const chain = { snapshot: vi.fn().mockResolvedValue(snapshot) };
    const service = new AdsService(
      { adChainEvent: { findFirst } } as never,
      {} as never,
      chain as never,
    );
    await expect(service.transaction(txHash, principal as never)).resolves.toEqual({
      chainStatus: 'SYNCED',
      chainId: 84532,
      contractAddress: address('99'),
      indexed: true,
      blockNumber: '110',
      blockHash: `0x${'33'.repeat(32)}`,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        chainId: 84532,
        contractAddress: address('99'),
        txHash: txHash.toLowerCase(),
        eventName: 'PositionChanged',
        blockNumber: { lte: 120n },
        payload: { path: ['stakerAddress'], equals: principal.address.toLowerCase() },
      },
      select: { blockNumber: true, blockHash: true },
    });
    await expect(service.transaction(txHash, principal as never)).resolves.toMatchObject({
      indexed: false,
      blockNumber: null,
      blockHash: null,
    });
    chain.snapshot.mockResolvedValue({ ...snapshot, status: 'SYNCING' });
    await expect(service.transaction(txHash, principal as never)).resolves.toMatchObject({
      chainStatus: 'SYNCING',
      indexed: false,
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed transaction hash before accessing the chain projection', async () => {
    const chain = { snapshot: vi.fn() };
    const service = new AdsService({} as never, {} as never, chain as never);
    await expect(service.transaction('invalid', {} as never)).rejects.toThrow(
      'Invalid transaction hash',
    );
    expect(chain.snapshot).not.toHaveBeenCalled();
  });
});
