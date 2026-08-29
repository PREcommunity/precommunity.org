import { BadRequestException } from '@nestjs/common';
import { ForumTopicStatus, Prisma } from '@precommunity/database';
import type { ProfileProjection } from '../common/public-profile';
import { publicAuthorProfile } from '../common/public-profile';

export const DEFAULT_REPLY_LIMIT = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function serializeForumAuthor(user: { address: string; profile: ProfileProjection | null }) {
  return publicAuthorProfile(user.address, user.profile);
}

export const topicSummaryInclude = {
  author: { include: { profile: true } },
} satisfies Prisma.ForumTopicInclude;

export const replyInclude = {
  author: { include: { profile: true } },
  parentReply: { include: { author: { include: { profile: true } } } },
} satisfies Prisma.ForumReplyInclude;

export const topicInclude = {
  ...topicSummaryInclude,
  replies: {
    include: replyInclude,
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: DEFAULT_REPLY_LIMIT + 1,
  },
} satisfies Prisma.ForumTopicInclude;

type TopicWithAuthor = Prisma.ForumTopicGetPayload<{ include: typeof topicSummaryInclude }>;
type TopicWithRelations = Prisma.ForumTopicGetPayload<{ include: typeof topicInclude }>;
type ReplyWithAuthor = Prisma.ForumReplyGetPayload<{ include: typeof replyInclude }>;

function topicState(topic: Pick<TopicWithAuthor, 'deletedAt' | 'removedAt'>) {
  return topic.removedAt
    ? ('REMOVED' as const)
    : topic.deletedAt
      ? ('DELETED' as const)
      : ('ACTIVE' as const);
}

export function serializeForumSummary(topic: TopicWithAuthor) {
  const hidden = Boolean(topic.deletedAt || topic.removedAt);
  return {
    id: topic.id,
    slug: hidden ? topic.id : topic.slug,
    title: hidden ? null : topic.title,
    excerpt: hidden ? null : topic.body.replace(/\s+/g, ' ').trim().slice(0, 180),
    state: topicState(topic),
    category: topic.category,
    status: topic.status,
    replyCount: topic.replyCount,
    lastActivityAt: topic.lastActivityAt.toISOString(),
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
    author: serializeForumAuthor(topic.author),
  };
}

export function serializeForumReply(reply: ReplyWithAuthor) {
  const parentReply = reply.parentReply
    ? {
        id: reply.parentReply.id,
        body:
          reply.parentReply.deletedAt || reply.parentReply.removedAt
            ? null
            : reply.parentReply.body,
        state: reply.parentReply.removedAt
          ? ('REMOVED' as const)
          : reply.parentReply.deletedAt
            ? ('DELETED' as const)
            : ('ACTIVE' as const),
        author: serializeForumAuthor(reply.parentReply.author),
      }
    : null;
  return {
    id: reply.id,
    body: reply.deletedAt || reply.removedAt ? null : reply.body,
    state: reply.removedAt
      ? ('REMOVED' as const)
      : reply.deletedAt
        ? ('DELETED' as const)
        : ('ACTIVE' as const),
    editedAt: reply.editedAt?.toISOString() ?? null,
    createdAt: reply.createdAt.toISOString(),
    author: serializeForumAuthor(reply.author),
    parentReply,
  };
}

export function encodeReplyCursor(reply: Pick<ReplyWithAuthor, 'createdAt' | 'id'>) {
  return Buffer.from(
    JSON.stringify({ createdAt: reply.createdAt.toISOString(), id: reply.id }),
  ).toString('base64url');
}

export function serializeForumDetail(topic: TopicWithRelations) {
  const page = topic.replies.slice(0, DEFAULT_REPLY_LIMIT);
  return {
    ...serializeForumSummary(topic),
    body: topic.deletedAt || topic.removedAt ? null : topic.body,
    moderationNote: topic.status === ForumTopicStatus.DECLINED ? topic.moderationNote : null,
    replies: page.map(serializeForumReply).reverse(),
    nextReplyCursor:
      topic.replies.length > DEFAULT_REPLY_LIMIT ? encodeReplyCursor(page[page.length - 1]!) : null,
  };
}

export function serializeForumMineDetail(topic: TopicWithAuthor) {
  return {
    ...serializeForumSummary(topic),
    body: topic.deletedAt || topic.removedAt ? null : topic.body,
    moderationNote: topic.status === ForumTopicStatus.DECLINED ? topic.moderationNote : null,
    replies: [],
    nextReplyCursor: null,
  };
}

export function encodeForumCursor(topic: Pick<TopicWithAuthor, 'lastActivityAt' | 'id'>) {
  return Buffer.from(
    JSON.stringify({ lastActivityAt: topic.lastActivityAt.toISOString(), id: topic.id }),
  ).toString('base64url');
}

export function decodeForumCursor(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      lastActivityAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.lastActivityAt !== 'string' || typeof parsed.id !== 'string')
      throw new Error('invalid');
    const lastActivityAt = new Date(parsed.lastActivityAt);
    if (Number.isNaN(lastActivityAt.getTime()) || !UUID_PATTERN.test(parsed.id))
      throw new Error('invalid');
    return { lastActivityAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Forum cursor is invalid');
  }
}

export function decodeReplyCursor(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string')
      throw new Error('invalid');
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !UUID_PATTERN.test(parsed.id))
      throw new Error('invalid');
    return { createdAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Forum reply cursor is invalid');
  }
}

export function forumTopicIdentity(value: string): Prisma.ForumTopicWhereUniqueInput {
  return UUID_PATTERN.test(value) ? { id: value } : { slug: value };
}
