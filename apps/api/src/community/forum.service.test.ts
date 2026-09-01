import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ForumTopicStatus, Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { formatUnits, maxUint256 } from 'viem';
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
const forumCategories = [
  { value: 'GENERAL', label: 'General', position: 0 },
  { value: 'IDEAS_FEEDBACK', label: 'Ideas & Feedback', position: 1 },
  { value: 'TECHNICAL', label: 'Technical', position: 2 },
  { value: 'HELP', label: 'Help', position: 3 },
].map((category) => ({
  ...category,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
}));

function topic(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    slug: 'first-topic-a1b2c3',
    authorId: principal.userId,
    title: 'First useful topic',
    body: 'A useful opening post for the community.',
    category: 'GENERAL',
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
      findUnique: vi.fn().mockResolvedValue({
        forumTopicModerationEnabled: false,
        forumMinimumPreRaw: null,
      }),
      upsert: vi.fn(),
    },
    forumCategory: {
      findUnique: vi.fn(({ where }: { where: { value: string } }) =>
        Promise.resolve(forumCategories.find((category) => category.value === where.value) ?? null),
      ),
      findFirst: vi.fn().mockResolvedValue(forumCategories[0]),
      findMany: vi.fn().mockResolvedValue(forumCategories),
      count: vi.fn().mockResolvedValue(forumCategories.length),
      create: vi.fn(),
      update: vi.fn(),
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
    minimum: vi.fn((amountRaw = 1_000_000_000_000_000_000n) => ({
      amount: formatUnits(amountRaw, 18),
      amountRaw: amountRaw.toString(),
      asset: 'PRE',
    })),
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
        category: 'GENERAL',
      },
      principal,
    );
    expect(eligibility.assertCurrent).toHaveBeenCalledWith(
      principal.address,
      1_000_000_000_000_000_000n,
      'write in the forum',
    );
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
          category: 'GENERAL',
        },
        principal,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.forumTopic.create).not.toHaveBeenCalled();
  });

  it('sends only newly created topics to review when moderation is enabled', async () => {
    const { prisma, service } = setup();
    prisma.communitySettings.findUnique.mockResolvedValue({
      forumTopicModerationEnabled: true,
      forumMinimumPreRaw: null,
    });
    prisma.forumTopic.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic(data),
    );
    const result = await service.create(
      {
        title: 'Reviewed topic',
        body: 'A useful opening post for moderator review.',
        category: 'TECHNICAL',
      },
      principal,
    );
    expect(result.status).toBe(ForumTopicStatus.PENDING_REVIEW);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.communitySettings.findUnique.mock.invocationCallOrder.at(-1)!,
    );
    expect(prisma.communitySettings.findUnique.mock.invocationCallOrder.at(-1)).toBeLessThan(
      prisma.forumTopic.create.mock.invocationCallOrder[0]!,
    );
  });

  it('saves an incomplete private draft without checking PRE eligibility', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.forumTopic.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic(data),
    );

    const result = await service.createDraft({ title: '' }, principal);

    expect(result.status).toBe(ForumTopicStatus.DRAFT);
    expect(result.body).toBe('');
    expect(eligibility.assertCurrent).not.toHaveBeenCalled();
    expect(prisma.forumTopic.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: ForumTopicStatus.DRAFT }),
    });
  });

  it('limits each account to twenty active drafts', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.count.mockResolvedValue(20);

    await expect(service.createDraft({}, principal)).rejects.toThrow(
      'Delete an existing draft before creating more than 20',
    );
    expect(prisma.forumTopic.create).not.toHaveBeenCalled();
  });

  it('publishes an owned draft with the current threshold and moderation setting', async () => {
    const { prisma, eligibility, service } = setup();
    prisma.communitySettings.findUnique.mockResolvedValue({
      forumTopicModerationEnabled: true,
      forumMinimumPreRaw: '12500000000000000000',
    });
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ status: ForumTopicStatus.DRAFT }));
    prisma.forumTopic.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      topic({ ...data, replies: [] }),
    );

    const result = await service.publishDraft(
      '00000000-0000-4000-8000-000000000010',
      {
        title: 'Published from a draft',
        body: 'This draft now contains enough context to publish.',
        category: 'IDEAS_FEEDBACK',
      },
      principal,
    );

    expect(eligibility.assertCurrent).toHaveBeenCalledWith(
      principal.address,
      12_500_000_000_000_000_000n,
      'write in the forum',
    );
    expect(result.status).toBe(ForumTopicStatus.PENDING_REVIEW);
    expect(prisma.forumTopic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdAt: expect.any(Date),
          lastActivityAt: expect.any(Date),
          status: ForumTopicStatus.PENDING_REVIEW,
        }),
      }),
    );
  });

  it('does not let another account save an owned draft', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(
      topic({
        authorId: '00000000-0000-4000-8000-000000000002',
        status: ForumTopicStatus.DRAFT,
      }),
    );

    await expect(
      service.updateDraft(
        '00000000-0000-4000-8000-000000000010',
        { title: 'Private draft' },
        principal,
      ),
    ).rejects.toThrow('Only the author can edit this draft');
    expect(prisma.forumTopic.update).not.toHaveBeenCalled();
  });

  it('applies the hourly topic limit when publishing a draft', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ status: ForumTopicStatus.DRAFT }));
    prisma.forumTopic.count.mockResolvedValue(3);

    await expect(
      service.publishDraft(
        '00000000-0000-4000-8000-000000000010',
        {
          title: 'Fourth published topic',
          body: 'This completed draft exceeds the hourly publication limit.',
          category: 'GENERAL',
        },
        principal,
      ),
    ).rejects.toThrow('Topic limit reached');
    expect(prisma.forumTopic.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid activity cursor before querying topics', async () => {
    const { prisma, service } = setup();
    await expect(service.list(undefined, 'not-a-cursor')).rejects.toThrow(
      'Forum cursor is invalid',
    );
    expect(prisma.forumTopic.findMany).not.toHaveBeenCalled();
  });

  it('filters drafts, soft-deleted and moderator-removed topics from the public list', async () => {
    const { prisma, service } = setup();

    await service.list();

    expect(prisma.forumTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] },
          deletedAt: null,
          removedAt: null,
        }),
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
          category: 'GENERAL',
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

describe('ForumService categories', () => {
  it('returns database categories in forum configuration order', async () => {
    const { service } = setup();

    const result = await service.config();

    expect(result.categories).toEqual([
      { value: 'GENERAL', label: 'General', archived: false },
      { value: 'IDEAS_FEEDBACK', label: 'Ideas & Feedback', archived: false },
      { value: 'TECHNICAL', label: 'Technical', archived: false },
      { value: 'HELP', label: 'Help', archived: false },
    ]);
  });

  it('creates an appended category with a generated stable identifier and audit event', async () => {
    const { prisma, service } = setup();
    prisma.forumCategory.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ position: 3 });
    prisma.forumCategory.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const result = await service.createCategory({ label: '  Aktualności  ' }, principal);

    expect(result).toEqual({ value: 'AKTUALNOSCI', label: 'Aktualności', archived: false });
    expect(prisma.forumCategory.create).toHaveBeenCalledWith({
      data: { value: 'AKTUALNOSCI', label: 'Aktualności', position: 4 },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CREATE_FORUM_CATEGORY' }),
      }),
    );
  });

  it('rejects duplicate category identifiers or names', async () => {
    const { prisma, service } = setup();

    await expect(service.createCategory({ label: 'General' }, principal)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.forumCategory.create).not.toHaveBeenCalled();
  });

  it('renames a category without changing its identifier', async () => {
    const { prisma, service } = setup();
    prisma.forumCategory.findFirst.mockResolvedValueOnce(null);
    prisma.forumCategory.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...forumCategories[0], ...data }),
    );

    const result = await service.updateCategory('GENERAL', { label: 'Community' }, principal);

    expect(result).toEqual({ value: 'GENERAL', label: 'Community', archived: false });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'UPDATE_FORUM_CATEGORY' }),
      }),
    );
  });

  it('archives and restores categories while retaining their position', async () => {
    const { prisma, service } = setup();
    prisma.forumCategory.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...forumCategories[0], ...data }),
    );

    const archived = await service.updateCategory('GENERAL', { archived: true }, principal);
    expect(archived.archived).toBe(true);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ARCHIVE_FORUM_CATEGORY' }),
      }),
    );

    prisma.forumCategory.findUnique.mockResolvedValue({
      ...forumCategories[0],
      archivedAt: now,
    });
    prisma.forumCategory.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...forumCategories[0],
        archivedAt: now,
        ...data,
      }),
    );
    const restored = await service.updateCategory('GENERAL', { archived: false }, principal);
    expect(restored).toEqual({ value: 'GENERAL', label: 'General', archived: false });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESTORE_FORUM_CATEGORY' }),
      }),
    );
  });

  it('does not archive the last active category', async () => {
    const { prisma, service } = setup();
    prisma.forumCategory.count.mockResolvedValue(1);

    await expect(service.updateCategory('GENERAL', { archived: true }, principal)).rejects.toThrow(
      'at least one active category',
    );
    expect(prisma.forumCategory.update).not.toHaveBeenCalled();
  });

  it('rejects an empty category update', async () => {
    const { service } = setup();

    await expect(service.updateCategory('GENERAL', {}, principal)).rejects.toThrow(
      'Provide a category name or archive state',
    );
  });

  it('keeps archived categories filterable but rejects them for new topics and publishing', async () => {
    const { prisma, service } = setup();
    const archived = { ...forumCategories[2], archivedAt: now };
    prisma.forumCategory.findUnique.mockResolvedValue(archived);

    await service.list('TECHNICAL');
    expect(prisma.forumTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'TECHNICAL' }) }),
    );
    await expect(
      service.create(
        {
          title: 'Archived category topic',
          body: 'This topic cannot use an archived category.',
          category: 'TECHNICAL',
        },
        principal,
      ),
    ).rejects.toThrow('Forum category is archived');
    await expect(
      service.publishDraft(
        '00000000-0000-4000-8000-000000000010',
        {
          title: 'Archived category draft',
          body: 'This draft must move before it can be published.',
          category: 'TECHNICAL',
        },
        principal,
      ),
    ).rejects.toThrow('Forum category is archived');
  });

  it('rejects a nonexistent category filter before querying topics', async () => {
    const { prisma, service } = setup();
    prisma.forumCategory.findUnique.mockResolvedValue(null);

    await expect(service.list('MISSING')).rejects.toThrow('Forum category does not exist');
    expect(prisma.forumTopic.findMany).not.toHaveBeenCalled();
  });

  it('allows an unchanged archived category during editing but rejects moving into one', async () => {
    const unchanged = setup();
    unchanged.prisma.forumTopic.findUnique.mockResolvedValue(topic());
    const result = await unchanged.service.update(
      '00000000-0000-4000-8000-000000000010',
      { body: 'Updated opening post with enough useful context.', category: 'GENERAL' },
      principal,
    );
    expect(result.category).toBe('GENERAL');
    expect(unchanged.prisma.forumCategory.findUnique).not.toHaveBeenCalled();

    const moved = setup();
    moved.prisma.forumTopic.findUnique.mockResolvedValue(topic());
    moved.prisma.forumCategory.findUnique.mockResolvedValue({
      ...forumCategories[2],
      archivedAt: now,
    });
    await expect(
      moved.service.update(
        '00000000-0000-4000-8000-000000000010',
        { category: 'TECHNICAL' },
        principal,
      ),
    ).rejects.toThrow('Forum category is archived');
    expect(moved.prisma.forumTopic.updateMany).not.toHaveBeenCalled();
  });
});

describe('ForumService administrator editing', () => {
  function moderator(role: Role) {
    return {
      ...principal,
      userId: '00000000-0000-4000-8000-000000000002',
      address: '0x0000000000000000000000000000000000000002',
      roles: [role],
    };
  }

  it.each([Role.SUPER_ADMIN, Role.CONTENT_ADMIN])(
    'lets %s edit another locked topic and records the change',
    async (role) => {
      const { prisma, service } = setup();
      const actor = moderator(role);
      const original = topic({ status: ForumTopicStatus.LOCKED });
      const updated = topic({
        status: ForumTopicStatus.LOCKED,
        title: 'Corrected topic title',
        body: 'Corrected opening post with useful context.',
        editedAt: now,
      });
      prisma.forumTopic.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);

      await service.update(original.id, { title: updated.title, body: updated.body }, actor);

      const update = prisma.forumTopic.updateMany.mock.calls[0]![0];
      expect(update.where).toMatchObject({
        status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] },
      });
      expect(update.where).not.toHaveProperty('authorId');
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorAddress: actor.address,
            entityType: 'ForumTopic',
            entityId: original.id,
            action: 'EDIT_FORUM_TOPIC',
            before: { title: original.title, body: original.body, category: original.category },
            after: { title: updated.title, body: updated.body, category: updated.category },
          }),
        }),
      );
    },
  );

  it('lets a content administrator edit another response in a locked topic', async () => {
    const { prisma, service } = setup();
    const actor = moderator(Role.CONTENT_ADMIN);
    const original = { ...forumReply(1), topic: topic({ status: ForumTopicStatus.LOCKED }) };
    const updated = { ...original, body: 'Corrected response', editedAt: now };
    prisma.forumReply.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);

    await service.editReply(original.id, { body: updated.body }, actor);

    const update = prisma.forumReply.updateMany.mock.calls[0]![0];
    expect(update.where).toMatchObject({
      topic: { is: { status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] } } },
    });
    expect(update.where).not.toHaveProperty('authorId');
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorAddress: actor.address,
          entityType: 'ForumReply',
          entityId: original.id,
          action: 'EDIT_FORUM_REPLY',
          before: { body: original.body },
          after: { body: updated.body },
        }),
      }),
    );
  });

  it('keeps unmoderated users and inactive topics out of administrator editing', async () => {
    const outsider = { ...principal, userId: '00000000-0000-4000-8000-000000000002' };
    const regular = setup();
    regular.prisma.forumTopic.findUnique.mockResolvedValue(topic());
    await expect(
      regular.service.update(
        '00000000-0000-4000-8000-000000000010',
        { body: 'Changed.' },
        outsider,
      ),
    ).rejects.toThrow('Only the author can edit this topic');

    const pending = setup();
    pending.prisma.forumTopic.findUnique.mockResolvedValue(
      topic({ status: ForumTopicStatus.PENDING_REVIEW }),
    );
    await expect(
      pending.service.update(
        '00000000-0000-4000-8000-000000000010',
        { body: 'Changed.' },
        moderator(Role.CONTENT_ADMIN),
      ),
    ).rejects.toThrow('Only active published or locked topics can be edited by an administrator');
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

  it('persists and audits an exact forum PRE minimum', async () => {
    const { prisma, service } = setup();
    prisma.communitySettings.upsert.mockResolvedValue({
      forumTopicModerationEnabled: false,
      forumMinimumPreRaw: '12500000000000000000',
    });

    const result = await service.updateMinimumPre({ amount: '12.5' }, principal);

    expect(result.minimumPre).toEqual({
      amount: '12.5',
      amountRaw: '12500000000000000000',
      asset: 'PRE',
    });
    expect(prisma.communitySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ forumMinimumPreRaw: '12500000000000000000' }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'UPDATE_FORUM_MINIMUM_PRE' }),
      }),
    );
  });

  it('rejects a forum PRE minimum outside the token range', async () => {
    const { service } = setup();
    await expect(
      service.updateMinimumPre({ amount: (maxUint256 + 1n).toString() }, principal),
    ).rejects.toThrow('exceeds the token range');
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

  it('does not expose a private draft through moderator removal', async () => {
    const { prisma, service } = setup();
    prisma.forumTopic.findUnique.mockResolvedValue(topic({ status: ForumTopicStatus.DRAFT }));

    await expect(
      service.moderateTopic('00000000-0000-4000-8000-000000000010', 'REMOVE', undefined, principal),
    ).rejects.toThrow('Topic cannot be changed with remove');
    expect(prisma.forumTopic.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
