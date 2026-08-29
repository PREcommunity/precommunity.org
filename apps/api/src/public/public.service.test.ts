import {
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MetadataStatus,
  MonthlySurplusPolicy,
  PayoutKind,
  SponsorVisibility,
} from '@precommunity/database';
import {
  DEFAULT_SUBPROJECT_NAME,
  DEFAULT_SUBPROJECT_SLUG,
  PRECOMMUNITY_ESCROW_ABI,
  deploymentStateKey,
} from '@precommunity/shared';
import { decodeFunctionData } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import {
  PublicService,
  fundingProgress,
  imageMimeFromMagic,
  metadataFrom,
  sponsorAttribution,
} from './public.service';
import { mapPublicFundingGoal } from './funding-presenter';

const address = '0x0000000000000000000000000000000000000001';
const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    active: true,
    revision: 3n,
    displayName: 'Current name',
    websiteUrl: 'https://example.org',
    avatarUri: `ipfs://${cid}/avatar.png`,
    avatarStatus: MetadataStatus.UNAVAILABLE,
    bio: 'Bio',
    defaultPublic: true,
    hidden: false,
    ...overrides,
  };
}

describe('fundingProgress', () => {
  it('keeps monetary values exact above Number.MAX_SAFE_INTEGER', () => {
    const unit = 10n ** 18n;
    const target = 9_007_199_254_740_993n * unit;
    const result = fundingProgress('PRE', target, target + unit, 0n);

    expect(result.target).toBe('9007199254740993');
    expect(result.funded).toBe('9007199254740994');
    expect(result.surplus).toBe('1');
    expect(result.percent).toBe(100);
  });
});

describe('monthly public projection', () => {
  const preUnit = 10n ** 18n;
  const now = Date.parse('2028-01-15T12:00:00.000Z');
  const period = {
    id: 'period-1',
    goalId: 'goal-1',
    periodIndex: 1,
    startsAt: new Date('2028-01-01T00:00:00.000Z'),
    endsAt: new Date('2028-02-01T00:00:00.000Z'),
    surplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
    finalPeriod: false,
    preContributedRaw: (8n * preUnit).toString(),
    usdcContributedRaw: '0',
    preCarryInRaw: (2n * preUnit).toString(),
    usdcCarryInRaw: '0',
    preRecipientEntitlementAddedRaw: (6n * preUnit).toString(),
    usdcRecipientEntitlementAddedRaw: '0',
    preCarryOutRaw: (4n * preUnit).toString(),
    usdcCarryOutRaw: '0',
    settlementTxHash: null,
    settlementBlock: null,
    settlementBlockHash: null,
    settlementLogIndex: null,
    settledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const goal = {
    id: 'goal-1',
    expenseId: null,
    chainId: config.deployment.chainId,
    chainGoalId: `0x${'11'.repeat(32)}`,
    creatorAddress: address,
    goalType: FundingGoalType.MONTHLY,
    monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
    monthlyFirstSettlementAt: period.endsAt,
    monthlySettlementDay: 1,
    monthlyStopRequestedAt: null,
    monthlyPeriodsSettled: 0,
    slug: 'monthly-goal',
    monthStart: period.startsAt,
    title: 'Monthly goal',
    description: 'Recurring public work.',
    recipientAddress: address,
    deadline: period.endsAt,
    metadataUri: null,
    metadataStatus: MetadataStatus.NOT_SET,
    metadata: null,
    legacyCategory: null,
    legacyDiscussionUrl: null,
    preTargetRaw: (10n * preUnit).toString(),
    usdcTargetRaw: '0',
    preRecipientEntitlementRaw: (10n * preUnit).toString(),
    usdcRecipientEntitlementRaw: '0',
    preCarryRaw: (4n * preUnit).toString(),
    usdcCarryRaw: '0',
    preTreasuryEntitlementRaw: '0',
    usdcTreasuryEntitlementRaw: '0',
    status: FundingGoalStatus.OPEN,
    creationTxHash: `0x${'22'.repeat(32)}`,
    creationBlock: 100n,
    creationBlockHash: `0x${'33'.repeat(32)}`,
    publishedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    periods: [period],
  };

  it('exposes active, stopping and settlement-due phases without a scheduled state', () => {
    const phase = (overrides: Record<string, unknown>) =>
      mapPublicFundingGoal({ ...goal, ...overrides } as never, new Map(), new Map(), new Map(), now)
        .monthly?.phase;

    expect(
      phase({
        periods: [
          {
            ...period,
            startsAt: new Date('2028-02-01T00:00:00.000Z'),
            endsAt: new Date('2028-03-01T00:00:00.000Z'),
          },
        ],
      }),
    ).toBe('ACTIVE');
    expect(phase({})).toBe('ACTIVE');
    expect(phase({ monthlyStopRequestedAt: new Date('2028-01-10T00:00:00.000Z') })).toBe(
      'STOPPING',
    );
    expect(
      phase({
        deadline: new Date('2028-12-31T00:00:00.000Z'),
        periods: [{ ...period, endsAt: new Date('2028-01-01T00:00:00.000Z') }],
      }),
    ).toBe('ACTIVE');
    expect(
      phase({
        deadline: new Date('2028-01-01T00:00:00.000Z'),
        periods: [{ ...period, endsAt: new Date('2028-12-31T00:00:00.000Z') }],
      }),
    ).toBe('SETTLEMENT_DUE');
  });

  it('exposes the confirmed anchor and uses the selected period end as the public deadline', () => {
    const projected = mapPublicFundingGoal(
      {
        ...goal,
        deadline: new Date('2028-12-31T00:00:00.000Z'),
        monthlyFirstSettlementAt: new Date('2028-02-29T00:00:00.000Z'),
        monthlySettlementDay: 31,
      } as never,
      new Map(),
      new Map(),
      new Map(),
      now,
    );

    expect(projected.deadline).toBe('2028-02-01T00:00:00.000Z');
    expect(projected.monthly).toMatchObject({
      firstSettlementAt: '2028-02-29T00:00:00.000Z',
      settlementDay: 31,
    });
  });

  it('subtracts executed and reserved payouts from lifetime entitlement', () => {
    const projected = mapPublicFundingGoal(
      goal as never,
      new Map([[`goal-1:${FundingAsset.PRE}`, 12n * preUnit]]),
      new Map([[`goal-1:${FundingAsset.PRE}:${PayoutKind.EXPENSE}`, 2n * preUnit]]),
      new Map([[`goal-1:${FundingAsset.PRE}:${PayoutKind.EXPENSE}`, 3n * preUnit]]),
      now,
    );

    expect(projected.monthly?.lifetime[0]).toMatchObject({
      asset: 'PRE',
      contributions: '12',
      beneficiaryEntitlement: '10',
      beneficiaryPayouts: '2',
      beneficiaryAvailable: '5',
    });
  });
});

describe('public goal metadata', () => {
  it('removes the internal General subproject from the public projection', () => {
    expect(
      metadataFrom({
        schema: 'precommunity.goal-metadata.v1',
        subproject: { name: DEFAULT_SUBPROJECT_NAME, slug: DEFAULT_SUBPROJECT_SLUG },
      }),
    ).toEqual({ schema: 'precommunity.goal-metadata.v1' });
  });
});

describe('contribution profile attribution', () => {
  it('uses an active profile, including for an anonymous contribution', () => {
    expect(sponsorAttribution(SponsorVisibility.ANONYMOUS, address, profile())).toEqual({
      label: 'Current name',
      sponsorUrl: `/community/profiles/${address}`,
      sponsorAvatarUrl: `/v1/public/profiles/${address}/avatar?revision=3`,
    });
  });

  it('labels an anonymous contribution without an active profile as an anonymous user', () => {
    expect(sponsorAttribution(SponsorVisibility.ANONYMOUS, address, null)).toEqual({
      label: 'Anonymous user',
    });
  });

  it('uses the current active profile, and falls back to the address after clear or moderation', () => {
    expect(sponsorAttribution(SponsorVisibility.PUBLIC, address, profile())).toEqual({
      label: 'Current name',
      sponsorUrl: `/community/profiles/${address}`,
      sponsorAvatarUrl: `/v1/public/profiles/${address}/avatar?revision=3`,
    });
    expect(
      sponsorAttribution(SponsorVisibility.PUBLIC, address, profile({ active: false })),
    ).toEqual({ label: '0x0000…0001' });
    expect(
      sponsorAttribution(SponsorVisibility.PUBLIC, address, profile({ hidden: true })),
    ).toEqual({ label: '0x0000…0001' });
    expect(sponsorAttribution(SponsorVisibility.PUBLIC, address, null)).toEqual({
      label: '0x0000…0001',
    });
  });
});

describe('goal contribution pagination', () => {
  it('returns a bounded page joined to the current profile and an opaque cursor', async () => {
    const now = new Date();
    const rows = [3, 2, 1].map((number) => ({
      id: `00000000-0000-4000-8000-00000000000${number}`,
      amountRaw: '1000000000000000000',
      asset: FundingAsset.PRE,
      visibility: SponsorVisibility.PUBLIC,
      confirmedAt: now,
      blockNumber: BigInt(100 + number),
      txHash: `0x${String(number).repeat(64)}`,
      logIndex: number,
      contributor: address,
      user: { profile: profile({ displayName: `Name ${number}` }) },
    }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const findGoal = vi.fn().mockResolvedValue({ id: 'goal-1' });
    const service = new PublicService({
      indexerState: {
        findUnique: vi.fn().mockResolvedValue({ lastBlockNumber: 200n, updatedAt: now }),
      },
      fundingGoal: { findUnique: findGoal },
      cryptoContribution: { findMany },
    } as never);

    const result = await service.contributions('goal', undefined, '2');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ label: 'Name 3', amount: '1', visibility: 'PUBLIC' });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(findGoal).toHaveBeenCalledWith({
      where: {
        chainId_slug: { chainId: config.deployment.chainId, slug: 'goal' },
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));

    findMany.mockResolvedValueOnce([]);
    await service.contributions('goal', result.nextCursor!, '2');
    expect(findMany.mock.calls[1]![0].where.OR).toHaveLength(4);
  });
});

describe('public monthly settlement request', () => {
  it('caps catch-up calldata at 24 periods and reports that another transaction is required', async () => {
    const now = new Date();
    const chainGoalId = `0x${'77'.repeat(32)}`;
    const service = new PublicService({
      indexerState: {
        findUnique: vi.fn().mockResolvedValue({ lastBlockNumber: 500n, updatedAt: now }),
      },
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-1',
          chainGoalId,
          goalType: FundingGoalType.MONTHLY,
          status: FundingGoalStatus.OPEN,
          deadline: new Date('2020-01-01T00:00:00.000Z'),
          monthlyFirstSettlementAt: new Date('2020-01-01T00:00:00.000Z'),
          monthlySettlementDay: 31,
          monthlyStopRequestedAt: null,
        }),
      },
    } as never);

    const result = await service.settlementRequest('monthly-goal');
    const decoded = decodeFunctionData({
      abi: PRECOMMUNITY_ESCROW_ABI,
      data: result.transactionRequest.data,
    });

    expect(result).toMatchObject({
      goalId: chainGoalId,
      maxPeriods: 24,
      indexedThroughBlock: '500',
    });
    expect(result.periodsDue).toBeGreaterThan(24);
    expect(result.remainingAfterThisTransaction).toBe(result.periodsDue - 24);
    expect(decoded).toEqual({ functionName: 'settleMonthlyGoal', args: [chainGoalId, 24] });
  });

  it('counts catch-up periods from the preserved settlement day after a clamped February', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-03-31T00:00:00.000Z'));
    try {
      const chainGoalId = `0x${'88'.repeat(32)}`;
      const service = new PublicService({
        indexerState: {
          findUnique: vi.fn().mockResolvedValue({
            lastBlockNumber: 500n,
            updatedAt: new Date('2028-03-31T00:00:00.000Z'),
          }),
        },
        fundingGoal: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'goal-1',
            chainGoalId,
            goalType: FundingGoalType.MONTHLY,
            status: FundingGoalStatus.OPEN,
            deadline: new Date('2028-02-29T00:00:00.000Z'),
            monthlyFirstSettlementAt: new Date('2028-02-29T00:00:00.000Z'),
            monthlySettlementDay: 31,
            monthlyStopRequestedAt: null,
          }),
        },
      } as never);

      await expect(service.settlementRequest('monthly-goal')).resolves.toMatchObject({
        periodsDue: 2,
        maxPeriods: 2,
        remainingAfterThisTransaction: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('paginates period history by descending period index', async () => {
    const now = new Date();
    const period = (periodIndex: number) => ({
      id: `period-${periodIndex}`,
      goalId: 'goal-1',
      periodIndex,
      startsAt: new Date(Date.UTC(2028, periodIndex - 1, 1)),
      endsAt: new Date(Date.UTC(2028, periodIndex, 1)),
      surplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
      finalPeriod: false,
      preContributedRaw: '10',
      usdcContributedRaw: '0',
      preCarryInRaw: '0',
      usdcCarryInRaw: '0',
      preRecipientEntitlementAddedRaw: '10',
      usdcRecipientEntitlementAddedRaw: '0',
      preCarryOutRaw: '0',
      usdcCarryOutRaw: '0',
      settlementTxHash: `0x${String(periodIndex).repeat(64)}`,
      settlementBlock: BigInt(100 + periodIndex),
      settlementBlockHash: `0x${String(periodIndex + 1).repeat(64)}`,
      settlementLogIndex: periodIndex,
      settledAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const findMany = vi.fn().mockResolvedValue([period(3), period(2), period(1)]);
    const service = new PublicService({
      indexerState: {
        findUnique: vi.fn().mockResolvedValue({ lastBlockNumber: 500n, updatedAt: now }),
      },
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-1',
          goalType: FundingGoalType.MONTHLY,
          preTargetRaw: '100',
          usdcTargetRaw: '0',
        }),
      },
      fundingGoalPeriod: { findMany },
    } as never);

    const result = await service.periods('monthly-goal', undefined, '2');

    expect(result.items.map((item) => item.periodIndex)).toEqual([3, 2]);
    expect(result.nextCursor).toBe('2');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { periodIndex: 'desc' }, take: 3 }),
    );
  });
});

describe('controlled IPFS avatar endpoint', () => {
  afterEach(() => vi.unstubAllGlobals());

  function serviceForAvatar(profileValue = profile()) {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return {
      updateMany,
      service: new PublicService({
        user: { findUnique: vi.fn().mockResolvedValue({ profile: profileValue }) },
        sponsorProfile: { updateMany },
      } as never),
    };
  }

  it('rejects malformed CIDs without requesting the gateway', async () => {
    const { service, updateMany } = serviceForAvatar(profile({ avatarUri: 'ipfs://not-a-cid' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(service.avatar(address, '3')).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { avatarStatus: MetadataStatus.INVALID } }),
    );
  });

  it('rejects SVG, oversize bodies and MIME spoofing', async () => {
    const svg = serviceForAvatar();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
        ),
    );
    await expect(svg.service.avatar(address, '3')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );

    const oversize = serviceForAvatar();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x', {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024 + 1) },
        }),
      ),
    );
    await expect(oversize.service.avatar(address, '3')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );

    const spoofed = serviceForAvatar();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    await expect(spoofed.service.avatar(address, '3')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('accepts only matching PNG, JPEG or WebP magic bytes', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(imageMimeFromMagic(png)).toBe('image/png');
    expect(imageMimeFromMagic(new TextEncoder().encode('<svg/>'))).toBeNull();
    const { service, updateMany } = serviceForAvatar();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
        ),
    );
    await expect(service.avatar(address, '3')).resolves.toMatchObject({ contentType: 'image/png' });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { avatarStatus: MetadataStatus.AVAILABLE } }),
    );
  });
});

describe('empty chain ledger', () => {
  it('stays unavailable until the active deployment completes its first confirmed sync', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = new PublicService({ indexerState: { findUnique } } as never);

    await expect(service.dashboard('2026-08')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: deploymentStateKey(config.deployment) },
    });
  });
});

describe('funding dashboard queries', () => {
  it('aggregates monetary history in the database and bounds both activity streams', async () => {
    const now = new Date();
    const goalId = '00000000-0000-4000-8000-000000000010';
    const findGoals = vi.fn().mockResolvedValue([
      {
        id: goalId,
        slug: 'bounded-goal',
        title: 'Bounded public goal',
        description: 'A goal used to verify bounded dashboard queries.',
        status: FundingGoalStatus.OPEN,
        deadline: new Date(now.getTime() + 60_000),
        metadataStatus: MetadataStatus.NOT_SET,
        metadata: null,
        chainGoalId: `0x${'11'.repeat(32)}`,
        recipientAddress: address,
        preTargetRaw: '3000000000000000000',
        usdcTargetRaw: '0',
        creationTxHash: `0x${'22'.repeat(32)}`,
        creationBlock: 100n,
      },
    ]);
    const raw = vi
      .fn()
      .mockResolvedValueOnce([
        { goalId, asset: FundingAsset.PRE, amountRaw: '2000000000000000000' },
      ])
      .mockResolvedValueOnce([
        { goalId, asset: FundingAsset.PRE, amountRaw: '1000000000000000000' },
      ]);
    const contributionFindMany = vi.fn().mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000020',
        amountRaw: '2000000000000000000',
        asset: FundingAsset.PRE,
        visibility: SponsorVisibility.PUBLIC,
        contributor: address,
        confirmedAt: now,
        txHash: `0x${'33'.repeat(32)}`,
        user: { profile: profile() },
      },
    ]);
    const payoutFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: '00000000-0000-4000-8000-000000000030',
          amountRaw: '1000000000000000000',
          asset: FundingAsset.PRE,
          kind: PayoutKind.EXPENSE,
          chainTxHash: `0x${'44'.repeat(32)}`,
          executedAt: new Date(now.getTime() - 1_000),
          createdAt: new Date(now.getTime() - 2_000),
          goal: { title: 'Bounded public goal' },
        },
      ])
      .mockResolvedValueOnce([]);
    const service = new PublicService({
      indexerState: {
        findUnique: vi.fn().mockResolvedValue({ lastBlockNumber: 200n, updatedAt: now }),
      },
      fundingGoal: { findMany: findGoals },
      cryptoContribution: { findMany: contributionFindMany },
      payout: { findMany: payoutFindMany },
      $queryRaw: raw,
    } as never);

    const dashboard = await service.dashboard('2026-08');

    expect(dashboard.goals[0]?.progress[0]).toMatchObject({
      target: '3',
      funded: '2',
      released: '1',
    });
    expect(dashboard.activity).toHaveLength(2);
    expect(findGoals.mock.calls[0]![0]).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          {
            goalType: FundingGoalType.ONE_TIME,
            publishedAt: { lt: new Date('2026-09-01T00:00:00.000Z') },
            OR: [
              { deadline: { gt: new Date('2026-08-01T00:00:00.000Z') } },
              { closedAt: { gte: new Date('2026-08-01T00:00:00.000Z') } },
            ],
          },
          {
            goalType: FundingGoalType.MONTHLY,
            periods: {
              some: {
                startsAt: { lt: new Date('2026-09-01T00:00:00.000Z') },
                endsAt: { gt: new Date('2026-08-01T00:00:00.000Z') },
              },
            },
          },
        ]),
      },
      include: {
        periods: {
          where: {
            startsAt: { lt: new Date('2026-09-01T00:00:00.000Z') },
            endsAt: { gt: new Date('2026-08-01T00:00:00.000Z') },
          },
          orderBy: { periodIndex: 'desc' },
          take: 1,
        },
      },
    });
    expect(raw).toHaveBeenCalledTimes(2);
    expect(contributionFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect(payoutFindMany).toHaveBeenCalledTimes(2);
    expect(payoutFindMany.mock.calls.every(([query]) => query.take === 20)).toBe(true);
  });
});
