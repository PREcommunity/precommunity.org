import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ForumCategory, ForumTopicStatus, Prisma } from '@precommunity/database';
import { FORUM_CATEGORIES, PROJECT_SLUG } from '@precommunity/shared';
import { maxUint256, parseUnits } from 'viem';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { createSlug } from '../common/slug';
import { writeAuditEvent } from '../common/audit';
import {
  ForumReplyDto,
  ForumSettingsDto,
  ForumDraftDto,
  ForumMinimumPreDto,
  CreateForumTopicDto,
  UpdateForumTopicDto,
} from './forum.dto';
import {
  DEFAULT_REPLY_LIMIT,
  decodeForumCursor,
  decodeReplyCursor,
  encodeForumCursor,
  encodeReplyCursor,
  forumTopicIdentity,
  replyInclude,
  serializeForumAuthor,
  serializeForumDetail,
  serializeForumMineDetail,
  serializeForumReply,
  serializeForumSummary,
  topicInclude,
  topicSummaryInclude,
} from './forum-presenter';
import { TokenEligibilityService } from './token-eligibility.service';

const PUBLIC_STATUSES = [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_REPLY_LIMIT = 100;
const MAX_DRAFTS = 20;

@Injectable()
export class ForumService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TokenEligibilityService) private readonly eligibility: TokenEligibilityService,
  ) {}

  private async project() {
    const project = await this.prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
    if (!project)
      throw new NotFoundException(
        'The precommunity project is not configured; run the database seed once',
      );
    return project;
  }

  private async settings() {
    const project = await this.project();
    return this.prisma.communitySettings.findUnique({
      where: { projectId: project.id },
    });
  }

  private minimumRaw(settings?: { forumMinimumPreRaw?: string | null } | null) {
    return BigInt(settings?.forumMinimumPreRaw ?? this.eligibility.minimum().amountRaw);
  }

  private async assertForumEligible(address: string) {
    const settings = await this.settings();
    return this.eligibility.assertCurrent(address, this.minimumRaw(settings), 'write in the forum');
  }

  async config() {
    return this.configFrom(await this.settings());
  }

  async list(category?: ForumCategory, cursorValue?: string, rawLimit?: string) {
    const cursor = decodeForumCursor(cursorValue);
    const parsedLimit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      throw new BadRequestException(`Forum limit must be between 1 and ${MAX_LIMIT}`);
    }
    const cursorWhere: Prisma.ForumTopicWhereInput | undefined = cursor
      ? {
          OR: [
            { lastActivityAt: { lt: cursor.lastActivityAt } },
            { lastActivityAt: cursor.lastActivityAt, id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const topics = await this.prisma.forumTopic.findMany({
      where: {
        status: { in: [...PUBLIC_STATUSES] },
        category,
        deletedAt: null,
        removedAt: null,
        AND: cursorWhere,
      },
      include: topicSummaryInclude,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: parsedLimit + 1,
    });
    const hasMore = topics.length > parsedLimit;
    const items = topics.slice(0, parsedLimit);
    return {
      items: items.map(serializeForumSummary),
      nextCursor: hasMore ? encodeForumCursor(items[items.length - 1]!) : null,
    };
  }

  async get(slug: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: forumTopicIdentity(slug),
      include: topicInclude,
    });
    if (
      !topic ||
      topic.deletedAt ||
      topic.removedAt ||
      !PUBLIC_STATUSES.includes(topic.status as (typeof PUBLIC_STATUSES)[number])
    )
      throw new NotFoundException('Forum topic not found');
    return serializeForumDetail(topic);
  }

  async replies(slug: string, cursorValue?: string, rawLimit?: string) {
    const cursor = decodeReplyCursor(cursorValue);
    const parsedLimit = rawLimit === undefined ? DEFAULT_REPLY_LIMIT : Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_REPLY_LIMIT) {
      throw new BadRequestException(`Forum reply limit must be between 1 and ${MAX_REPLY_LIMIT}`);
    }
    const topic = await this.prisma.forumTopic.findUnique({
      where: forumTopicIdentity(slug),
      select: { id: true, status: true, deletedAt: true, removedAt: true },
    });
    if (
      !topic ||
      topic.deletedAt ||
      topic.removedAt ||
      !PUBLIC_STATUSES.includes(topic.status as (typeof PUBLIC_STATUSES)[number])
    )
      throw new NotFoundException('Forum topic not found');
    const cursorWhere: Prisma.ForumReplyWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const replies = await this.prisma.forumReply.findMany({
      where: { topicId: topic.id, AND: cursorWhere },
      include: replyInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: parsedLimit + 1,
    });
    const hasMore = replies.length > parsedLimit;
    const page = replies.slice(0, parsedLimit);
    return {
      items: page.map(serializeForumReply).reverse(),
      nextCursor: hasMore ? encodeReplyCursor(page[page.length - 1]!) : null,
    };
  }

  async mine(actor: AuthenticatedPrincipal) {
    const topics = await this.prisma.forumTopic.findMany({
      where: { authorId: actor.userId, deletedAt: null, removedAt: null },
      include: topicSummaryInclude,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return topics.map(serializeForumMineDetail);
  }

  async createDraft(dto: ForumDraftDto, actor: AuthenticatedPrincipal) {
    const draft = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const draftCount = await tx.forumTopic.count({
        where: {
          authorId: actor.userId,
          status: ForumTopicStatus.DRAFT,
          deletedAt: null,
          removedAt: null,
        },
      });
      if (draftCount >= MAX_DRAFTS) {
        throw new ConflictException(
          `Delete an existing draft before creating more than ${MAX_DRAFTS}`,
        );
      }
      return tx.forumTopic.create({
        data: {
          authorId: actor.userId,
          slug: createSlug(dto.title ?? '', 'draft'),
          title: dto.title ?? '',
          body: dto.body ?? '',
          category: dto.category ?? ForumCategory.GENERAL,
          status: ForumTopicStatus.DRAFT,
        },
        include: topicSummaryInclude,
      });
    });
    return serializeForumMineDetail(draft);
  }

  async updateDraft(id: string, dto: ForumDraftDto, actor: AuthenticatedPrincipal) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "ForumTopic" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const draft = await tx.forumTopic.findUnique({ where: { id } });
      if (!draft) throw new NotFoundException('Forum draft not found');
      if (draft.authorId !== actor.userId)
        throw new ForbiddenException('Only the author can edit this draft');
      if (draft.status !== ForumTopicStatus.DRAFT || draft.deletedAt || draft.removedAt)
        throw new ConflictException('Only an active draft can be saved');
      const updated = await tx.forumTopic.update({
        where: { id },
        data: { title: dto.title, body: dto.body, category: dto.category },
        include: topicSummaryInclude,
      });
      return serializeForumMineDetail(updated);
    });
  }

  async publishDraft(id: string, dto: CreateForumTopicDto, actor: AuthenticatedPrincipal) {
    await this.assertForumEligible(actor.address);
    const project = await this.project();
    const topic = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR SHARE`;
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const draft = await tx.forumTopic.findUnique({ where: { id } });
      if (!draft) throw new NotFoundException('Forum draft not found');
      if (draft.authorId !== actor.userId)
        throw new ForbiddenException('Only the author can publish this draft');
      if (draft.status !== ForumTopicStatus.DRAFT || draft.deletedAt || draft.removedAt)
        throw new ConflictException('Only an active draft can be published');
      const since = new Date(Date.now() - 60 * 60 * 1000);
      if (
        (await tx.forumTopic.count({
          where: {
            authorId: actor.userId,
            status: { not: ForumTopicStatus.DRAFT },
            createdAt: { gte: since },
          },
        })) >= 3
      ) {
        throw new HttpException(
          'Topic limit reached; try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const settings = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const now = new Date();
      return tx.forumTopic.update({
        where: { id },
        data: {
          slug: createSlug(dto.title, 'topic'),
          title: dto.title,
          body: dto.body,
          category: dto.category,
          status: settings?.forumTopicModerationEnabled
            ? ForumTopicStatus.PENDING_REVIEW
            : ForumTopicStatus.PUBLISHED,
          createdAt: now,
          lastActivityAt: now,
          editedAt: null,
        },
        include: topicInclude,
      });
    });
    return serializeForumDetail(topic);
  }

  async create(dto: CreateForumTopicDto, actor: AuthenticatedPrincipal) {
    await this.assertForumEligible(actor.address);
    const project = await this.project();
    const topic = await this.prisma.$transaction(async (tx) => {
      // Topic creation and moderation changes share this project-row lock. This
      // gives the switch a single ordering point without serializing creators.
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR SHARE`;
      const settings = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const status = settings?.forumTopicModerationEnabled
        ? ForumTopicStatus.PENDING_REVIEW
        : ForumTopicStatus.PUBLISHED;
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const since = new Date(Date.now() - 60 * 60 * 1000);
      if (
        (await tx.forumTopic.count({
          where: {
            authorId: actor.userId,
            status: { not: ForumTopicStatus.DRAFT },
            createdAt: { gte: since },
          },
        })) >= 3
      ) {
        throw new HttpException(
          'Topic limit reached; try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return tx.forumTopic.create({
        data: {
          authorId: actor.userId,
          slug: createSlug(dto.title, 'topic'),
          title: dto.title.trim(),
          body: dto.body.trim(),
          category: dto.category,
          status,
        },
        include: topicInclude,
      });
    });
    return serializeForumDetail(topic);
  }

  async update(id: string, dto: UpdateForumTopicDto, actor: AuthenticatedPrincipal) {
    await this.assertForumEligible(actor.address);
    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.forumTopic.findUnique({ where: { id } });
      if (!topic) throw new NotFoundException('Forum topic not found');
      if (topic.authorId !== actor.userId)
        throw new ForbiddenException('Only the author can edit this topic');
      const changed = await tx.forumTopic.updateMany({
        where: {
          id,
          authorId: actor.userId,
          deletedAt: null,
          removedAt: null,
          status: { in: [ForumTopicStatus.PENDING_REVIEW, ForumTopicStatus.PUBLISHED] },
        },
        data: {
          title: dto.title?.trim(),
          body: dto.body?.trim(),
          category: dto.category,
          editedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('A locked, removed or declined topic cannot be edited');
      const updated = await tx.forumTopic.findUnique({ where: { id }, include: topicInclude });
      if (!updated) throw new NotFoundException('Forum topic not found');
      return serializeForumDetail(updated);
    });
  }

  async delete(id: string, actor: AuthenticatedPrincipal) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "ForumTopic" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const topic = await tx.forumTopic.findUnique({ where: { id } });
      if (!topic) throw new NotFoundException('Forum topic not found');
      if (topic.authorId !== actor.userId)
        throw new ForbiddenException('Only the author can delete this topic');
      if (topic.deletedAt || topic.removedAt) return { ok: true };
      const now = new Date();
      await tx.forumTopic.update({ where: { id }, data: { deletedAt: now } });
      return { ok: true };
    });
  }

  async reply(topicId: string, dto: ForumReplyDto, actor: AuthenticatedPrincipal) {
    await this.assertForumEligible(actor.address);
    const topic = await this.prisma.forumTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Forum topic not found');
    if (topic.status !== ForumTopicStatus.PUBLISHED || topic.deletedAt || topic.removedAt)
      throw new ConflictException('This topic is not open for replies');
    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const since = new Date(Date.now() - 60_000);
      if (
        (await tx.forumReply.count({
          where: { authorId: actor.userId, createdAt: { gte: since } },
        })) >= 10
      ) {
        throw new HttpException(
          'Reply limit reached; wait a moment before posting again',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const stillOpen = await tx.forumTopic.updateMany({
        where: {
          id: topicId,
          status: ForumTopicStatus.PUBLISHED,
          deletedAt: null,
          removedAt: null,
        },
        data: { replyCount: { increment: 1 }, lastActivityAt: now },
      });
      if (stillOpen.count !== 1) throw new ConflictException('This topic is not open for replies');
      const [currentTopic, parentReply, priorParticipants] = await Promise.all([
        tx.forumTopic.findUnique({ where: { id: topicId }, select: { authorId: true } }),
        dto.parentReplyId
          ? tx.forumReply.findFirst({
              where: { id: dto.parentReplyId, topicId, deletedAt: null, removedAt: null },
              select: { authorId: true },
            })
          : null,
        tx.forumReply.findMany({
          where: { topicId },
          distinct: ['authorId'],
          select: { authorId: true },
        }),
      ]);
      if (!currentTopic) throw new NotFoundException('Forum topic not found');
      if (dto.parentReplyId && !parentReply)
        throw new BadRequestException('Quoted reply is unavailable or belongs to another topic');
      const reply = await tx.forumReply.create({
        data: {
          topicId,
          authorId: actor.userId,
          body: dto.body.trim(),
          parentReplyId: dto.parentReplyId,
        },
        include: replyInclude,
      });
      const recipients = new Set([
        currentTopic.authorId,
        ...priorParticipants.map((participant) => participant.authorId),
      ]);
      if (parentReply) recipients.add(parentReply.authorId);
      recipients.delete(actor.userId);
      if (recipients.size) {
        await tx.forumNotification.createMany({
          data: [...recipients].map((recipientId) => ({
            recipientId,
            actorId: actor.userId,
            topicId,
            replyId: reply.id,
          })),
          skipDuplicates: true,
        });
      }
      return reply;
    });
    return serializeForumReply(created);
  }

  async notifications(actor: AuthenticatedPrincipal) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.forumNotification.findMany({
        where: { recipientId: actor.userId },
        include: {
          actor: { include: { profile: true } },
          topic: { select: { slug: true, title: true, deletedAt: true, removedAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      this.prisma.forumNotification.count({ where: { recipientId: actor.userId, readAt: null } }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        replyId: item.replyId,
        topic: {
          slug: item.topic.slug,
          title: item.topic.deletedAt || item.topic.removedAt ? null : item.topic.title,
        },
        actor: serializeForumAuthor(item.actor),
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
      unreadCount,
    };
  }

  async markNotificationRead(id: string, actor: AuthenticatedPrincipal) {
    const result = await this.prisma.forumNotification.updateMany({
      where: { id, recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!result.count) {
      const notification = await this.prisma.forumNotification.findFirst({
        where: { id, recipientId: actor.userId },
      });
      if (!notification) throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async markAllNotificationsRead(actor: AuthenticatedPrincipal) {
    await this.prisma.forumNotification.updateMany({
      where: { recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async editReply(id: string, dto: ForumReplyDto, actor: AuthenticatedPrincipal) {
    await this.assertForumEligible(actor.address);
    const reply = await this.prisma.forumReply.findUnique({
      where: { id },
      include: { topic: true },
    });
    if (!reply) throw new NotFoundException('Forum reply not found');
    if (reply.authorId !== actor.userId)
      throw new ForbiddenException('Only the author can edit this reply');
    const changed = await this.prisma.forumReply.updateMany({
      where: {
        id,
        authorId: actor.userId,
        deletedAt: null,
        removedAt: null,
        topic: { is: { status: ForumTopicStatus.PUBLISHED, deletedAt: null, removedAt: null } },
      },
      data: { body: dto.body.trim(), editedAt: new Date() },
    });
    if (changed.count !== 1)
      throw new ConflictException('A reply in a locked or removed topic cannot be edited');
    const updated = await this.prisma.forumReply.findUnique({ where: { id } });
    if (!updated) throw new NotFoundException('Forum reply not found');
    return updated;
  }

  async deleteReply(id: string, actor: AuthenticatedPrincipal) {
    const reply = await this.prisma.forumReply.findUnique({ where: { id } });
    if (!reply) throw new NotFoundException('Forum reply not found');
    if (reply.authorId !== actor.userId)
      throw new ForbiddenException('Only the author can delete this reply');
    if (!reply.deletedAt && !reply.removedAt)
      await this.prisma.forumReply.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  async adminWorkspace() {
    const [config, topics] = await Promise.all([
      this.config(),
      this.prisma.forumTopic.findMany({
        where: {
          status: {
            in: [
              ForumTopicStatus.PENDING_REVIEW,
              ForumTopicStatus.PUBLISHED,
              ForumTopicStatus.LOCKED,
            ],
          },
          deletedAt: null,
          removedAt: null,
        },
        include: topicSummaryInclude,
        orderBy: [{ status: 'asc' }, { lastActivityAt: 'desc' }],
        take: 100,
      }),
    ]);
    return {
      config,
      topics: topics.map((topic) => ({
        ...serializeForumSummary(topic),
        body: topic.deletedAt || topic.removedAt ? null : topic.body,
      })),
    };
  }

  async updateSettings(dto: ForumSettingsDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR UPDATE`;
      const before = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const settings = await tx.communitySettings.upsert({
        where: { projectId: project.id },
        update: {
          forumTopicModerationEnabled: dto.topicModerationEnabled,
          updatedBy: actor.address,
        },
        create: {
          projectId: project.id,
          forumTopicModerationEnabled: dto.topicModerationEnabled,
          updatedBy: actor.address,
        },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'CommunitySettings',
        entityId: project.id,
        action: 'UPDATE_FORUM_MODERATION',
        before: { forumTopicModerationEnabled: before?.forumTopicModerationEnabled ?? false },
        after: { forumTopicModerationEnabled: settings.forumTopicModerationEnabled },
      });
      return this.configFrom(settings);
    });
  }

  async updateMinimumPre(dto: ForumMinimumPreDto, actor: AuthenticatedPrincipal) {
    const minimumRaw = parseUnits(dto.amount, 18);
    if (minimumRaw > maxUint256)
      throw new BadRequestException('The forum PRE minimum exceeds the token range');
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR UPDATE`;
      const before = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const settings = await tx.communitySettings.upsert({
        where: { projectId: project.id },
        update: { forumMinimumPreRaw: minimumRaw.toString(), updatedBy: actor.address },
        create: {
          projectId: project.id,
          forumMinimumPreRaw: minimumRaw.toString(),
          updatedBy: actor.address,
        },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'CommunitySettings',
        entityId: project.id,
        action: 'UPDATE_FORUM_MINIMUM_PRE',
        before: { forumMinimumPreRaw: this.minimumRaw(before).toString() },
        after: { forumMinimumPreRaw: settings.forumMinimumPreRaw },
      });
      return this.configFrom(settings);
    });
  }

  private configFrom(
    settings?: {
      forumTopicModerationEnabled?: boolean;
      forumMinimumPreRaw?: string | null;
    } | null,
  ) {
    return {
      topicModerationEnabled: settings?.forumTopicModerationEnabled ?? false,
      minimumPre: this.eligibility.minimum(this.minimumRaw(settings)),
      categories: FORUM_CATEGORIES,
    };
  }

  async moderateTopic(
    id: string,
    action: 'APPROVE' | 'DECLINE' | 'LOCK' | 'UNLOCK' | 'REMOVE',
    note: string | undefined,
    actor: AuthenticatedPrincipal,
  ) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "ForumTopic" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const topic = await tx.forumTopic.findUnique({ where: { id } });
      if (!topic) throw new NotFoundException('Forum topic not found');
      const now = new Date();
      let data: Prisma.ForumTopicUpdateInput;
      if (
        action === 'APPROVE' &&
        topic.status === ForumTopicStatus.PENDING_REVIEW &&
        !topic.deletedAt &&
        !topic.removedAt
      )
        data = {
          status: ForumTopicStatus.PUBLISHED,
          moderatedBy: actor.address,
          moderationNote: note ?? null,
        };
      else if (
        action === 'DECLINE' &&
        topic.status === ForumTopicStatus.PENDING_REVIEW &&
        !topic.deletedAt &&
        !topic.removedAt
      )
        data = {
          status: ForumTopicStatus.DECLINED,
          moderatedBy: actor.address,
          moderationNote: note ?? null,
        };
      else if (
        action === 'LOCK' &&
        topic.status === ForumTopicStatus.PUBLISHED &&
        !topic.deletedAt &&
        !topic.removedAt
      )
        data = {
          status: ForumTopicStatus.LOCKED,
          lockedAt: now,
          moderatedBy: actor.address,
          moderationNote: note ?? null,
        };
      else if (
        action === 'UNLOCK' &&
        topic.status === ForumTopicStatus.LOCKED &&
        !topic.deletedAt &&
        !topic.removedAt
      )
        data = {
          status: ForumTopicStatus.PUBLISHED,
          lockedAt: null,
          moderatedBy: actor.address,
          moderationNote: note ?? null,
        };
      else if (
        action === 'REMOVE' &&
        topic.status !== ForumTopicStatus.DRAFT &&
        !topic.deletedAt &&
        !topic.removedAt
      )
        data = {
          removedAt: now,
          moderatedBy: actor.address,
          moderationNote: note ?? null,
        };
      else
        throw new ConflictException(
          `Topic cannot be changed with ${action.toLowerCase()} in its current state`,
        );
      const updated = await tx.forumTopic.update({ where: { id }, data, include: topicInclude });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'ForumTopic',
        entityId: id,
        action,
        before: { status: topic.status },
        after: { status: updated.status },
      });
      return serializeForumDetail(updated);
    });
  }

  async removeReply(id: string, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      const reply = await tx.forumReply.findUnique({ where: { id } });
      if (!reply) throw new NotFoundException('Forum reply not found');
      const updated = await tx.forumReply.update({
        where: { id },
        data: { removedAt: new Date() },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'ForumReply',
        entityId: id,
        action: 'REMOVE',
      });
      return { id: updated.id, removed: true };
    });
  }
}
