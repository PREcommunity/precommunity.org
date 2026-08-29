import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ForumCategory, ForumTopicStatus } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { ForumService } from './forum.service';

const principal = {
  userId: '00000000-0000-4000-8000-000000000001',
  address: '0x0000000000000000000000000000000000000001',
  roles: [],
  chainAuthorities: [],
  chainOwnerAddress: null,
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: false,
  safeAddress: null,
};
const now = new Date('2026-08-06T12:00:00.000Z');

function topic(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    slug: 'first-topic-a1b2c3',
    authorId: principal.userId,
    title: 'First useful topic',
    body: 'A useful opening post for the community.',
    category: ForumCategory.GENERAL,
    status: ForumTopicStatus.PUBLISHED,
    replyCount: 0,
    lastActivityAt: now,
    editedAt: null,
    deletedAt: null,
    lockedAt: null,
    removedAt: null,
    moderatedBy: null,
    moderationNote: null,
    createdAt: now,
    updatedAt: now,
    author: { address: principal.address, profile: null },
    replies: [],
    ...overrides,
  };
}

function forumReply(number: number) {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    topicId: '00000000-0000-4000-8000-000000000010',
    authorId: principal.userId,
    body: `Response ${number}`,
    editedAt: null,
    deletedAt: null,
    removedAt: null,
    createdAt: new Date(now.getTime() - number * 1_000),
    updatedAt: now,
    author: { address: principal.address, profile: null },
  };
}

function setup() {
  const prisma: Record<string, any> = {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000099', slug: 'precommunity' }),
    },
    communitySettings: {
      findUnique: vi.fn().mockResolvedValue({ forumTopicModerationEnabled: false }),
      upsert: vi.fn(),
    },
    forumTopic: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    forumReply: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    forumNotification: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: principal.userId }]);
  prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  const eligibility = {
    assertCurrent: vi.fn().mockResolvedValue(2n),
    minimum: vi
      .fn()
      .mockReturnValue({ amount: '1', amountRaw: '1000000000000000000', asset: 'PRE' }),
  };
  return { prisma, eligibility, service: new ForumService(prisma as never, eligibility as never) };
}

describe('ForumService publishing', () => {
  it('publishes immediately when topic moderation is disabled', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.forumTopic.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic(data),
    );
    const result = await service.create(
      {
        title: 'First useful topic',
        body: 'A useful opening post for the community.',
        category: ForumCategory.GENERAL,
      },
      principal,
    );
    expect(eligibility.assertCurrent).toHaveBeenCalledWith(principal.address);
    expect(result.status).toBe(ForumTopicStatus.PUBLISHED);
  });

  it('does not create a topic when the current wallet balance is below the PRE threshold', async () => {
    const { prisma, eligibility, service } = setup();
    eligibility.assertCurrent.mockRejectedValue(
      new ForbiddenException('At least 1 PRE is required to participate'),
    );

    await expect(
      service.create(
        {
          title: 'Ineligible topic',
          body: 'This topic must not reach the database.',
          category: ForumCategory.GENERAL,
        },
        principal,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.forumTopic.create).not.toHaveBeenCalled();
  });

  it('sends only newly created topics to review when moderation is enabled', async () => {
    const { prisma, service } = setup();
    prisma.communitySettings.findUnique.mockResolvedValue({ forumTopicModerationEnabled: true });
    prisma.forumTopic.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic(data),
    );
    const result = await service.create(
      {
        title: 'Reviewed topic',
        body: 'A useful opening post for moderator review.',
        category: ForumCategory.TECHNICAL,
      },
      principal,
    );
    expect(result.status).toBe(ForumTopicStatus.PENDING_REVIEW);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.communitySettings.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(prisma.communitySettings.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.forumTopic.create.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects an invalid activity cursor before querying topics', async () => {
    const { prisma, service } = setup();
    await expect(service.list(undefined, 'not-a-cursor')).rejects.toThrow(
      'Forum cursor is invalid',
    );
    expect(prisma.forumTopic.findMany).not.toHaveBeenCalled();
  });

  it('filters soft-deleted and moderator-removed topics from the public list', async () => {
    const { prisma, service } = setup();

    await service.list();

    expect(prisma.forumTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, removedAt: null }),
      }),
    );
  });

  it('checks and creates a topic while holding the author lock', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.count.mockResolvedValue(3);
    await expect(
      service.create(
        {
          title: 'Fourth useful topic',
          body: 'This topic should exceed the hourly author limit.',
          category: ForumCategory.GENERAL,
        },
        principal,
      ),
    ).rejects.toThrow('Topic limit reached');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.forumTopic.create).not.toHaveBeenCalled();
  });

  it('returns only the newest bounded reply page with an older-page cursor', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(
      topic({
        replyCount: 51,
        replies: Array.from({ length: 51 }, (_, index) => forumReply(index + 1)),
      }),
    );

    const result = await service.get('first-topic-a1b2c3');

    expect(result.replies).toHaveLength(50);
    expect(result.nextReplyCursor).toEqual(expect.any(String));
    expect(prisma.forumTopic.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ replies: expect.objectContaining({ take: 51 }) }),
      }),
    );
  });

  it('does not expose a soft-deleted topic through its direct URL', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(
      topic({ status: ForumTopicStatus.LOCKED, deletedAt: now }),
    );

    await expect(service.get('00000000-0000-4000-8000-000000000010')).rejects.toThrow(
      'Forum topic not found',
    );
    expect(prisma.forumTopic.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-4000-8000-000000000010' },
      }),
    );
  });

  it('paginates earlier replies chronologically and rejects invalid cursors', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000010',
      status: ForumTopicStatus.PUBLISHED,
      deletedAt: null,
      removedAt: null,
    });
    prisma.forumReply.findMany.mockResolvedValue([forumReply(1), forumReply(2), forumReply(3)]);

    const page = await service.replies('first-topic-a1b2c3', undefined, '2');

    expect(page.items.map((reply) => reply.id)).toEqual([forumReply(2).id, forumReply(1).id]);
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(service.replies('first-topic-a1b2c3', 'invalid')).rejects.toThrow(
      'Forum reply cursor is invalid',
    );
  });

  it('does not load discussion replies for the author topic register', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findMany.mockResolvedValue([
      topic({
        replyCount: 500,
        replies: Array.from({ length: 500 }, (_, index) => forumReply(index + 1)),
      }),
    ]);

    const result = await service.mine(principal);

    expect(result[0]).toMatchObject({ replyCount: 500, replies: [], nextReplyCursor: null });
    expect(prisma.forumTopic.findMany.mock.calls[0]![0].where).toMatchObject({
      authorId: principal.userId,
      deletedAt: null,
      removedAt: null,
    });
    expect(prisma.forumTopic.findMany.mock.calls[0]![0].include).not.toHaveProperty('replies');
  });
});

describe('ForumService author controls', () => {
  it('lets an author soft-delete a replied-to topic without locking it or checking balance', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ replyCount: 2 }));
    prisma.forumTopic.update.mockResolvedValue({});
    await service.delete('00000000-0000-4000-8000-000000000010', principal);
    expect(eligibility.assertCurrent).not.toHaveBeenCalled();
    expect(prisma.forumTopic.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-4000-8000-000000000010' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('soft-deletes an empty author topic without changing its status', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ replyCount: 0 }));
    prisma.forumTopic.update.mockResolvedValue({});

    await service.delete('00000000-0000-4000-8000-000000000010', principal);

    const data = prisma.forumTopic.update.mock.calls[0]![0].data;
    expect(data).toEqual({ deletedAt: expect.any(Date) });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('lockedAt');
    expect(data).not.toHaveProperty('removedAt');
  });

  it('blocks replies on a locked topic', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ status: ForumTopicStatus.LOCKED }));
    await expect(
      service.reply(
        '00000000-0000-4000-8000-000000000010',
        { body: 'This should not be posted.' },
        principal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.forumReply.create).not.toHaveBeenCalled();
  });

  it('adds an eligible response and advances activity atomically', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic());
    prisma.forumReply.create.mockResolvedValue({
      id: 'reply-1',
      body: 'A useful reply.',
      editedAt: null,
      deletedAt: null,
      removedAt: null,
      createdAt: now,
      author: { address: principal.address, profile: null },
    });
    prisma.forumTopic.updateMany.mockResolvedValue({ count: 1 });
    await service.reply(
      '00000000-0000-4000-8000-000000000010',
      { body: 'A useful reply.' },
      principal,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.forumTopic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          replyCount: { increment: 1 },
          lastActivityAt: expect.any(Date),
        }),
      }),
    );
  });

  it('notifies the topic author and prior participants except the new reply author', async () => {
    const { prisma, service } = setup();
    const otherUserId = '00000000-0000-4000-8000-000000000002';
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ authorId: otherUserId }));
    prisma.forumReply.findMany.mockResolvedValue([
      { authorId: otherUserId },
      { authorId: principal.userId },
    ]);
    prisma.forumReply.create.mockResolvedValue({
      ...forumReply(1),
      author: { address: principal.address, profile: null },
      parentReply: null,
    });

    await service.reply(
      '00000000-0000-4000-8000-000000000010',
      { body: 'A useful reply.' },
      principal,
    );

    expect(prisma.forumNotification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ recipientId: otherUserId, actorId: principal.userId })],
        skipDuplicates: true,
      }),
    );
  });

  it('rejects a quoted reply that is not active in the topic', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic());
    prisma.forumReply.findFirst.mockResolvedValue(null);

    await expect(
      service.reply(
        '00000000-0000-4000-8000-000000000010',
        {
          body: 'Replying to an unavailable message.',
          parentReplyId: '00000000-0000-4000-8000-000000000099',
        },
        principal,
      ),
    ).rejects.toThrow('Quoted reply is unavailable or belongs to another topic');
    expect(prisma.forumReply.create).not.toHaveBeenCalled();
  });

  it('marks every unread notification for the current user as read', async () => {
    const { prisma, service } = setup();

    await expect(service.markAllNotificationsRead(principal)).resolves.toEqual({ ok: true });

    expect(prisma.forumNotification.updateMany).toHaveBeenCalledWith({
      where: { recipientId: principal.userId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('checks the reply limit while holding the author lock', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic());
    prisma.forumReply.count.mockResolvedValue(10);
    await expect(
      service.reply(
        '00000000-0000-4000-8000-000000000010',
        { body: 'This response exceeds the limit.' },
        principal,
      ),
    ).rejects.toThrow('Reply limit reached');
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.forumReply.create).not.toHaveBeenCalled();
  });
});

describe('ForumService moderation', () => {
  it('persists the runtime topic-review switch and audits the change', async () => {
    const { prisma, service } = setup();
    prisma.communitySettings.upsert.mockResolvedValue({ forumTopicModerationEnabled: true });
    const result = await service.updateSettings({ topicModerationEnabled: true }, principal);
    expect(result.topicModerationEnabled).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.communitySettings.upsert.mock.invocationCallOrder[0]!,
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'UPDATE_FORUM_MODERATION' }),
      }),
    );
  });

  it('approves a pending topic and records the moderator action', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(
      topic({ status: ForumTopicStatus.PENDING_REVIEW }),
    );
    prisma.forumTopic.update.mockResolvedValue(topic({ status: ForumTopicStatus.PUBLISHED }));
    const result = await service.moderateTopic(
      '00000000-0000-4000-8000-000000000010',
      'APPROVE',
      undefined,
      principal,
    );
    expect(result.status).toBe(ForumTopicStatus.PUBLISHED);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPROVE' }) }),
    );
  });

  it('soft-removes a moderated topic with replies without locking it', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ replyCount: 2 }));
    prisma.forumTopic.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic({ ...data, replyCount: 2 }),
    );
    const result = await service.moderateTopic(
      '00000000-0000-4000-8000-000000000010',
      'REMOVE',
      undefined,
      principal,
    );
    expect(result).toMatchObject({ status: ForumTopicStatus.PUBLISHED, replyCount: 2 });
    expect(prisma.forumTopic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          removedAt: expect.any(Date),
          moderatedBy: principal.address,
          moderationNote: null,
        },
      }),
    );
  });
});
