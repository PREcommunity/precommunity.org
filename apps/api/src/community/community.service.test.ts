import { describe, expect, it, vi } from 'vitest';
import {
  CommunityProposalStatus,
  ForumTopicStatus,
  ProposalVoteChoice,
} from '@precommunity/database';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CommunityService } from './community.service';

const principal = {
  userId: 'user-1',
  address: '0x0000000000000000000000000000000000000001',
  roles: [],
  chainAuthorities: [],
  chainOwnerAddress: null,
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: false,
  safeAddress: null,
};

function setup() {
  const prisma: Record<string, any> = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1' }) },
    communitySettings: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    communityProposal: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    proposalVote: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  const eligibility = {
    assertCurrent: vi.fn(),
    confirmedSnapshotBlock: vi.fn().mockResolvedValue(321n),
    snapshotBalance: vi.fn().mockResolvedValue(5_000_000_000_000_000_000n),
    assertSnapshotEligible: vi.fn(),
  };
  return {
    prisma,
    eligibility,
    service: new CommunityService(prisma as never, eligibility as never),
  };
}

describe('CommunityService voting', () => {
  it('uses immutable snapshot weight and only updates the choice on a repeat vote', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.communityProposal.findUnique.mockResolvedValue({
      id: 'proposal-1',
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingEndsAt: new Date(Date.now() + 60_000),
    });
    await service.vote('proposal-1', { choice: ProposalVoteChoice.FOR }, principal);

    expect(eligibility.snapshotBalance).toHaveBeenCalledWith(principal.address, 321n);
    expect(prisma.proposalVote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { choice: ProposalVoteChoice.FOR },
        create: expect.objectContaining({ weightRaw: '5000000000000000000' }),
      }),
    );
  });

  it('does not let a post-snapshot holder vote when historical eligibility fails', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.communityProposal.findUnique.mockResolvedValue({
      id: 'proposal-1',
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingEndsAt: new Date(Date.now() + 60_000),
    });
    eligibility.snapshotBalance.mockResolvedValue(0n);
    eligibility.assertSnapshotEligible.mockImplementation(() => {
      throw new ForbiddenException();
    });

    await expect(
      service.vote('proposal-1', { choice: ProposalVoteChoice.FOR }, principal),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.proposalVote.upsert).not.toHaveBeenCalled();
  });

  it('rejects a vote when the proposal closes while the snapshot RPC is pending', async () => {
    const { prisma, service } = setup();
    const open = {
      id: 'proposal-1',
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingEndsAt: new Date(Date.now() + 60_000),
    };
    prisma.communityProposal.findUnique.mockResolvedValueOnce(open).mockResolvedValueOnce({
      ...open,
      status: CommunityProposalStatus.PASSED,
      closedAt: new Date(),
    });

    await expect(
      service.vote('proposal-1', { choice: ProposalVoteChoice.FOR }, principal),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.proposalVote.upsert).not.toHaveBeenCalled();
  });

  it('closes a tie as rejected and a strict weighted majority as passed', async () => {
    const { prisma, service } = setup();
    prisma.communityProposal.findMany.mockResolvedValue([{ id: 'tie' }, { id: 'pass' }]);
    const votingEndsAt = new Date(Date.now() - 1_000);
    prisma.communityProposal.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === 'tie'
          ? { id: 'tie', status: CommunityProposalStatus.VOTING, votingEndsAt }
          : { id: 'pass', status: CommunityProposalStatus.VOTING, votingEndsAt },
      ),
    );
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { proposalId: 'tie', choice: ProposalVoteChoice.FOR, weightRaw: '10', voterCount: 1 },
        { proposalId: 'tie', choice: ProposalVoteChoice.AGAINST, weightRaw: '10', voterCount: 1 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { proposalId: 'pass', choice: ProposalVoteChoice.FOR, weightRaw: '11', voterCount: 1 },
        { proposalId: 'pass', choice: ProposalVoteChoice.AGAINST, weightRaw: '10', voterCount: 1 },
      ]);
    await service.closeExpired();

    expect(prisma.communityProposal.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ status: CommunityProposalStatus.REJECTED }),
      }),
    );
    expect(prisma.communityProposal.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: CommunityProposalStatus.PASSED }),
      }),
    );
  });
});

describe('CommunityService proposal moderation', () => {
  const proposal = {
    id: 'proposal-1',
    slug: 'public-nodes-abc123',
    title: 'Public nodes',
    description: 'Fund resilient public infrastructure for the network.',
    category: 'Infrastructure',
    author: { address: principal.address, profile: null },
    convertedExpense: null,
    comments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('keeps new proposals pending when pre-moderation is enabled by default', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.communityProposal.create.mockResolvedValue({
      ...proposal,
      status: CommunityProposalStatus.PENDING_REVIEW,
    });

    await service.create(
      { title: proposal.title, description: proposal.description, category: proposal.category },
      principal,
    );

    expect(eligibility.confirmedSnapshotBlock).not.toHaveBeenCalled();
    expect(prisma.communityProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CommunityProposalStatus.PENDING_REVIEW,
          snapshotBlock: undefined,
        }),
      }),
    );
  });

  it('starts voting with a confirmed snapshot when pre-moderation is disabled', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.communitySettings.findUnique.mockResolvedValue({ proposalModerationEnabled: false });
    prisma.communityProposal.create.mockResolvedValue({
      ...proposal,
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingStartsAt: new Date(),
      votingEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await service.create(
      { title: proposal.title, description: proposal.description, category: proposal.category },
      principal,
    );

    expect(eligibility.confirmedSnapshotBlock).toHaveBeenCalledOnce();
    expect(prisma.communityProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CommunityProposalStatus.VOTING,
          snapshotBlock: 321n,
        }),
      }),
    );
  });
});

describe('CommunityService proposal lookup', () => {
  it('keeps the public proposal register free of full comment threads', async () => {
    const { prisma, service } = setup();

    await service.list();

    const listQuery = prisma.communityProposal.findMany.mock.calls.at(-1)?.[0];
    expect(listQuery.include).not.toHaveProperty('comments');
    expect(listQuery.include).not.toHaveProperty('votes');
  });

  it('uses one grouped database result for proposal vote totals', async () => {
    const { prisma, service } = setup();
    const now = new Date();
    const proposal = {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'aggregate-votes-a1b2c3',
      title: 'Aggregate proposal votes',
      description: 'Keep the public proposal register bounded.',
      category: 'Technical',
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingStartsAt: now,
      votingEndsAt: new Date(now.getTime() + 60_000),
      closedAt: null,
      moderationNote: null,
      createdAt: now,
      updatedAt: now,
      author: { address: principal.address, profile: null },
      convertedExpense: null,
    };
    prisma.communityProposal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([proposal]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { proposalId: proposal.id, choice: ProposalVoteChoice.FOR, weightRaw: '25', voterCount: 2 },
      {
        proposalId: proposal.id,
        choice: ProposalVoteChoice.ABSTAIN,
        weightRaw: '3',
        voterCount: 1,
      },
    ]);

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        results: { forRaw: '25', againstRaw: '0', abstainRaw: '3', voterCount: 3 },
      }),
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('queries a public proposal by slug without casting the slug to UUID', async () => {
    const { prisma, service } = setup();
    const now = new Date();
    prisma.communityProposal.findUnique.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'test-e98956',
      title: 'Test proposal',
      description: 'A proposal used to verify slug lookup.',
      category: 'Test',
      status: CommunityProposalStatus.VOTING,
      snapshotBlock: 321n,
      votingStartsAt: now,
      votingEndsAt: new Date(now.getTime() + 60_000),
      closedAt: null,
      moderationNote: null,
      createdAt: now,
      updatedAt: now,
      author: { address: principal.address, profile: null },
      votes: [],
      comments: [],
      convertedExpense: null,
    });

    await expect(service.get('test-e98956')).resolves.toMatchObject({
      slug: 'test-e98956',
      snapshotBlock: '321',
    });
    expect(prisma.communityProposal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'test-e98956' },
      }),
    );
  });
});

describe('CommunityService public profiles', () => {
  it('keeps pending submissions out of a public profile', async () => {
    const address = '0x0000000000000000000000000000000000000001';
    const findUnique = vi.fn().mockResolvedValue({
      address,
      profile: {
        id: 'profile-1',
        active: true,
        revision: 2n,
        displayName: 'Builder',
        websiteUrl: null,
        avatarUri: null,
        avatarStatus: 'NOT_SET',
        bio: null,
        defaultPublic: true,
        hidden: false,
      },
      proposals: [],
      comments: [],
      proposalVotes: [],
      forumTopics: [],
      forumReplies: [],
    });
    const service = new CommunityService({ user: { findUnique } } as never, {} as never);

    await service.publicProfile(address);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          proposals: expect.objectContaining({
            where: {
              status: {
                notIn: [CommunityProposalStatus.PENDING_REVIEW, CommunityProposalStatus.REMOVED],
              },
            },
          }),
          forumTopics: expect.objectContaining({
            where: expect.objectContaining({
              status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] },
            }),
          }),
          forumReplies: expect.objectContaining({
            where: expect.objectContaining({
              deletedAt: null,
              removedAt: null,
              topic: expect.objectContaining({ deletedAt: null, removedAt: null }),
            }),
          }),
        }),
      }),
    );
    expect(findUnique.mock.calls[0]![0].include.proposals.take).toBe(50);
  });

  it('does not expose the title of a soft-deleted topic through reply activity', async () => {
    const address = '0x0000000000000000000000000000000000000001';
    const findUnique = vi.fn().mockResolvedValue({
      address,
      profile: {
        id: 'profile-1',
        active: true,
        revision: 2n,
        displayName: 'Builder',
        websiteUrl: null,
        avatarUri: null,
        avatarStatus: 'NOT_SET',
        bio: null,
        defaultPublic: true,
        hidden: false,
      },
      proposals: [],
      comments: [],
      proposalVotes: [],
      forumTopics: [],
      forumReplies: [
        {
          id: 'reply-1',
          body: 'A public response.',
          createdAt: new Date(),
          topic: {
            id: '00000000-0000-4000-8000-000000000010',
            slug: 'deleted-topic-a1b2c3',
            title: 'Private after deletion',
            deletedAt: new Date(),
            removedAt: null,
          },
        },
      ],
    });
    const service = new CommunityService({ user: { findUnique } } as never, {} as never);

    await expect(service.publicProfile(address)).resolves.toMatchObject({
      forumReplies: [{ topic: { slug: '00000000-0000-4000-8000-000000000010', title: null } }],
    });
  });
});
