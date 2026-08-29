import {
  ChainAuthorityKind,
  MetadataStatus,
  PayoutStatus,
  resetChainProjection,
  SafePayoutProposalStatus,
  SponsorVisibility,
} from '@precommunity/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyAuthorityChange,
  applyProfileClear,
  applyProfileUpdate,
  chainReorganized,
  claimChainEvent,
  compareEscrowLogs,
  confirmedHead,
  refreshGoalMetadata,
  resetProfileProjectionAfterReorg,
  retryUnavailableMetadata,
  slugFor,
  visibilityForContribution,
} from './indexer';

const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe';

function prismaMock() {
  const update = vi.fn().mockResolvedValue({});
  return { client: { fundingGoal: { update } } as never, update };
}

describe('confirmation and restart boundaries', () => {
  it('indexes only through head minus exactly 6 confirmations', () => {
    expect(confirmedHead(5n, 0n, 6n)).toBeNull();
    expect(confirmedHead(6n, 0n, 6n)).toBe(0n);
    expect(confirmedHead(106n, 20n, 6n)).toBe(100n);
  });

  it('uses stable slugs and case-insensitive reorg checks', () => {
    expect(slugFor('Public Nodes!', `0x${'ab'.repeat(32)}`)).toBe('public-nodes-abababab');
    expect(chainReorganized('0xABCD', '0xabcd')).toBe(false);
    expect(chainReorganized('0xabcd', '0xef01')).toBe(true);
  });

  it('atomically lets only one concurrent indexer claim a chain event', async () => {
    const createMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const database = { chainEvent: { createMany } } as never;
    const event = {
      chainId: 84532,
      txHash: `0x${'ab'.repeat(32)}`,
      logIndex: 0,
      blockNumber: 123n,
      blockHash: `0x${'cd'.repeat(32)}`,
      eventName: 'OwnershipTransferred',
      payload: {},
    };

    await expect(claimChainEvent(database, event)).resolves.toBe(true);
    await expect(claimChainEvent(database, event)).resolves.toBe(false);
    expect(createMany).toHaveBeenCalledWith({ data: [event], skipDuplicates: true });
  });

  it('orders monthly lifecycle events from one transaction by their log index', () => {
    const events = [
      { name: 'MonthlyTokenSettled', blockNumber: 123n, logIndex: 8 },
      { name: 'MonthlyPeriodSettled', blockNumber: 123n, logIndex: 7 },
      { name: 'GoalClosed', blockNumber: 124n, logIndex: 0 },
    ];

    expect(events.sort(compareEscrowLogs).map((event) => event.name)).toEqual([
      'MonthlyPeriodSettled',
      'MonthlyTokenSettled',
      'GoalClosed',
    ]);
  });

  it('retains Safe records while clearing their rebuildable chain projection', async () => {
    const count = () => vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      fundingGoal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'safe-goal',
            expenseId: 'expense-1',
            _count: { safePayoutIntents: 1, safeGoalActionIntents: 1 },
          },
          {
            id: 'plain-goal',
            expenseId: null,
            _count: { safePayoutIntents: 0, safeGoalActionIntents: 0 },
          },
        ]),
        updateMany: count(),
        deleteMany: count(),
      },
      expense: { updateMany: count() },
      fundingGoalPeriod: { deleteMany: count() },
      cryptoContribution: { deleteMany: count() },
      payout: { deleteMany: count(), updateMany: count() },
      safePayoutProposal: { updateMany: count() },
      safeGoalActionProposal: { updateMany: count() },
      sponsorProfile: { updateMany: count() },
      chainAuthority: { deleteMany: count() },
      chainEvent: { deleteMany: count() },
      indexerState: { deleteMany: count() },
    };

    await resetChainProjection(database as never, {
      chainId: 84532,
      contractAddress: '0xescrow',
    });

    expect(database.fundingGoal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['safe-goal'] } },
        data: expect.objectContaining({
          monthlyFirstSettlementAt: null,
          monthlySettlementDay: null,
        }),
      }),
    );
    expect(database.fundingGoal.deleteMany).toHaveBeenCalledWith({
      where: {
        chainId: 84532,
        creationTxHash: { not: null },
        id: { notIn: ['safe-goal'] },
      },
    });
    expect(database.payout.deleteMany).toHaveBeenCalledWith({
      where: { goalId: { in: ['safe-goal'] }, safeIntent: null },
    });
    expect(database.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: PayoutStatus.EXECUTED }),
        data: expect.objectContaining({ status: PayoutStatus.PROPOSED, chainTxHash: null }),
      }),
    );
    expect(database.safePayoutProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SafePayoutProposalStatus.SUBMITTING }),
      }),
    );
  });
});

describe('confirmed chain authority projection', () => {
  it('replaces the projected owner on OwnershipTransferred', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const database = { chainAuthority: { deleteMany, upsert } } as never;

    await applyAuthorityChange(database, {
      kind: ChainAuthorityKind.OWNER,
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      enabled: true,
      blockNumber: 123n,
      txHash: `0x${'AB'.repeat(32)}`,
      logIndex: 4,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ kind: ChainAuthorityKind.OWNER }),
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          kind: ChainAuthorityKind.OWNER,
          blockNumber: 123n,
          txHash: `0x${'ab'.repeat(32)}`,
        }),
      }),
    );
  });

  it('revokes a goal manager without creating a database role', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn();
    const database = { chainAuthority: { deleteMany, upsert } } as never;

    await applyAuthorityChange(database, {
      kind: ChainAuthorityKind.GOAL_MANAGER,
      address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      enabled: false,
      blockNumber: 124n,
      txHash: `0x${'cd'.repeat(32)}`,
      logIndex: 1,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        kind: ChainAuthorityKind.GOAL_MANAGER,
      }),
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('confirmed community profile projection', () => {
  it('upserts the wallet and current profile without overwriting moderation', async () => {
    const userUpsert = vi.fn().mockResolvedValue({ id: 'user-1' });
    const profileUpsert = vi.fn().mockResolvedValue({});
    const database = {
      user: { upsert: userUpsert },
      sponsorProfile: { upsert: profileUpsert },
    } as never;

    await applyProfileUpdate(database, {
      account: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      revision: 7n,
      displayName: 'Builder',
      websiteUrl: 'https://example.org',
      bio: 'Public bio',
      avatarUri: `ipfs://${cid}/avatar.webp`,
      defaultPublic: true,
      blockNumber: 123n,
      blockHash: `0x${'AB'.repeat(32)}`,
      txHash: `0x${'CD'.repeat(32)}`,
      logIndex: 4,
    });

    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      }),
    );
    const update = profileUpsert.mock.calls[0]![0].update;
    expect(update).toMatchObject({
      active: true,
      revision: 7n,
      displayName: 'Builder',
      avatarStatus: MetadataStatus.UNAVAILABLE,
      defaultPublic: true,
      blockNumber: 123n,
      logIndex: 4,
    });
    expect(update).not.toHaveProperty('hidden');
  });

  it('clears chain content while retaining the moderation flag and revision history', async () => {
    const profileUpsert = vi.fn().mockResolvedValue({});
    const database = {
      user: { upsert: vi.fn().mockResolvedValue({ id: 'user-1' }) },
      sponsorProfile: { upsert: profileUpsert },
    } as never;

    await applyProfileClear(database, {
      account: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      revision: 8n,
      blockNumber: 124n,
      blockHash: `0x${'ef'.repeat(32)}`,
      txHash: `0x${'12'.repeat(32)}`,
      logIndex: 1,
    });

    const update = profileUpsert.mock.calls[0]![0].update;
    expect(update).toMatchObject({
      active: false,
      revision: 8n,
      displayName: null,
      avatarUri: null,
    });
    expect(update).not.toHaveProperty('hidden');
  });

  it('resets only chain profile fields on reorg and derives visibility from the event', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await resetProfileProjectionAfterReorg({ sponsorProfile: { updateMany } } as never);
    const data = updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ active: false, revision: 0n, displayName: null, txHash: null });
    expect(data).not.toHaveProperty('hidden');
    expect(visibilityForContribution(true)).toBe(SponsorVisibility.PUBLIC);
    expect(visibilityForContribution(false)).toBe(SponsorVisibility.ANONYMOUS);
  });
});

describe('IPFS projection fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks a malformed CID invalid without requesting a gateway', async () => {
    const { client, update } = prismaMock();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(refreshGoalMetadata(client, 'goal-1', 'ipfs://not-a-cid')).resolves.toBe(
      MetadataStatus.INVALID,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadataStatus: MetadataStatus.INVALID }),
      }),
    );
  });

  it('marks an unavailable gateway without changing core goal data', async () => {
    const { client, update } = prismaMock();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(refreshGoalMetadata(client, 'goal-1', `ipfs://${cid}`)).resolves.toBe(
      MetadataStatus.UNAVAILABLE,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'goal-1' },
        data: expect.objectContaining({ metadataStatus: MetadataStatus.UNAVAILABLE }),
      }),
    );
  });

  it('accepts the canonical metadata schema', async () => {
    const { client, update } = prismaMock();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema: 'precommunity.goal-metadata.v1',
            category: 'Infrastructure',
            subproject: { name: 'Public nodes', slug: 'public-nodes' },
            discussionUrl: 'https://example.org/discussion',
            documents: [{ label: 'Budget', url: 'https://example.org/budget' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await expect(refreshGoalMetadata(client, 'goal-1', `ipfs://${cid}`)).resolves.toBe(
      MetadataStatus.AVAILABLE,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataStatus: MetadataStatus.AVAILABLE,
          metadata: expect.objectContaining({ schema: 'precommunity.goal-metadata.v1' }),
        }),
      }),
    );
  });

  it('retries transiently unavailable metadata', async () => {
    const { client, update } = prismaMock();
    const findMany = vi.fn().mockResolvedValue([{ id: 'goal-1', metadataUri: `ipfs://${cid}` }]);
    Object.assign(client as object, { fundingGoal: { update, findMany } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema: 'precommunity.goal-metadata.v1',
            category: 'Infrastructure',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(retryUnavailableMetadata(client, 5)).resolves.toEqual({
      attempted: 1,
      recovered: 1,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metadataStatus: MetadataStatus.UNAVAILABLE }),
        take: 5,
      }),
    );
  });
});
