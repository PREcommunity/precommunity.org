import type {
  CommunityProposal,
  CommunityProposalStatus,
  DashboardResponse,
  ForumCategoryValue,
  ForumConfig,
  ForumTopicDetail,
  ForumTopicsPage,
  GoalContributionsPage,
  FundingGoalPeriodsPage,
  GoalSummary,
} from '@precommunity/shared';
import { ApiError, apiUrl, requestJson } from './http';
import { DISABLED_APPLICATION_FEATURES, type ApplicationFeatures } from './application-features';

const serverApiUrl = process.env.INTERNAL_API_URL ?? apiUrl;

export { apiUrl } from './http';

function serverJson<T>(path: string, label: string) {
  return requestJson<T>(`${serverApiUrl}${path}`, { cache: 'no-store' }, label);
}

export async function getApplicationFeatures(): Promise<ApplicationFeatures> {
  try {
    return await serverJson<ApplicationFeatures>('/v1/public/features', 'Application features');
  } catch {
    return DISABLED_APPLICATION_FEATURES;
  }
}

export function resolveApiAssetUrl(value?: string | null) {
  if (!value) return value ?? null;
  try {
    const absoluteValue = new URL(value);
    return ['http:', 'https:'].includes(absoluteValue.protocol) ? absoluteValue.toString() : null;
  } catch {
    // API-owned assets are returned as paths such as `/v1/public/profiles/...`.
  }

  try {
    const absoluteApiUrl = new URL(apiUrl);
    return new URL(value, absoluteApiUrl).toString();
  } catch {
    if (!apiUrl.startsWith('/')) return null;
    const basePath = apiUrl.replace(/\/+$/, '');
    const assetPath = value.replace(/^\/+/, '');
    return `${basePath}/${assetPath}`;
  }
}

function normalizeCommunityProposal(proposal: CommunityProposal): CommunityProposal {
  return {
    ...proposal,
    author: { ...proposal.author, avatarUrl: resolveApiAssetUrl(proposal.author.avatarUrl) },
    comments: proposal.comments?.map((comment) => ({
      ...comment,
      author: { ...comment.author, avatarUrl: resolveApiAssetUrl(comment.author.avatarUrl) },
    })),
  };
}

export async function getDashboard(month?: string): Promise<DashboardResponse> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  const dashboard = await serverJson<DashboardResponse>(
    `/v1/public/dashboard${query}`,
    'Verified ledger API',
  );
  return {
    ...dashboard,
    activity: dashboard.activity.map((item) => ({
      ...item,
      sponsorAvatarUrl: resolveApiAssetUrl(item.sponsorAvatarUrl) ?? undefined,
    })),
  };
}

export type DashboardAvailability =
  { status: 'READY'; dashboard: DashboardResponse } | { status: 'UNAVAILABLE'; dashboard: null };

export async function getDashboardAvailability(month?: string): Promise<DashboardAvailability> {
  try {
    return { status: 'READY', dashboard: await getDashboard(month) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      return { status: 'UNAVAILABLE', dashboard: null };
    }
    throw error;
  }
}

export async function getGoal(slug: string, month?: string): Promise<GoalSummary | null> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  try {
    return await serverJson<GoalSummary>(
      `/v1/public/goals/${encodeURIComponent(slug)}${query}`,
      'Verified goal API',
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getGoalContributions(
  slug: string,
  cursor?: string,
  limit = 25,
): Promise<GoalContributionsPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const page = await serverJson<GoalContributionsPage>(
    `/v1/public/goals/${encodeURIComponent(slug)}/contributions?${params}`,
    'Goal contributions API',
  );
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      sponsorAvatarUrl: resolveApiAssetUrl(item.sponsorAvatarUrl) ?? undefined,
    })),
  };
}

export async function getGoalPeriods(
  slug: string,
  cursor?: string,
  limit = 12,
): Promise<FundingGoalPeriodsPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return serverJson<FundingGoalPeriodsPage>(
    `/v1/public/goals/${encodeURIComponent(slug)}/periods?${params}`,
    'Goal periods API',
  );
}

export async function getCommunityProposals(
  status?: CommunityProposalStatus,
  category?: string,
): Promise<CommunityProposal[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  const query = params.size ? `?${params}` : '';
  return (
    await serverJson<CommunityProposal[]>(`/v1/community/proposals${query}`, 'Community API')
  ).map(normalizeCommunityProposal);
}

export async function getCommunityProposal(slug: string): Promise<CommunityProposal | null> {
  try {
    return normalizeCommunityProposal(
      await serverJson<CommunityProposal>(
        `/v1/community/proposals/${encodeURIComponent(slug)}`,
        'Community proposal API',
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getForumConfig(): Promise<ForumConfig> {
  return serverJson<ForumConfig>('/v1/community/forum/config', 'Forum configuration API');
}

export async function getForumTopics(
  options: { category?: ForumCategoryValue; cursor?: string; limit?: number } = {},
): Promise<ForumTopicsPage> {
  const params = new URLSearchParams();
  if (options.category) params.set('category', options.category);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.size ? `?${params}` : '';
  const page = await serverJson<ForumTopicsPage>(`/v1/community/forum/topics${query}`, 'Forum API');
  return {
    ...page,
    items: page.items.map((topic) => ({
      ...topic,
      author: { ...topic.author, avatarUrl: resolveApiAssetUrl(topic.author.avatarUrl) },
    })),
  };
}

export async function getForumTopic(slug: string): Promise<ForumTopicDetail | null> {
  let topic: ForumTopicDetail;
  try {
    topic = await serverJson<ForumTopicDetail>(
      `/v1/community/forum/topics/${encodeURIComponent(slug)}`,
      'Forum topic API',
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  return {
    ...topic,
    author: { ...topic.author, avatarUrl: resolveApiAssetUrl(topic.author.avatarUrl) },
    replies: topic.replies.map((reply) => ({
      ...reply,
      author: { ...reply.author, avatarUrl: resolveApiAssetUrl(reply.author.avatarUrl) },
      parentReply: reply.parentReply
        ? {
            ...reply.parentReply,
            author: {
              ...reply.parentReply.author,
              avatarUrl: resolveApiAssetUrl(reply.parentReply.author.avatarUrl),
            },
          }
        : null,
    })),
  };
}

export interface PublicCommunityProfile {
  address: string;
  profile: {
    active: true;
    revision: string;
    displayName: string | null;
    avatarUrl: string | null;
    websiteUrl: string | null;
    bio: string | null;
    defaultPublic: boolean;
  } | null;
  proposals: Array<{
    slug: string;
    title: string;
    status: CommunityProposalStatus;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    proposal: { slug: string; title: string };
  }>;
  votes: Array<{
    choice: string;
    weightRaw: string;
    createdAt: string;
    proposal: { slug: string; title: string; status: CommunityProposalStatus };
  }>;
  forumTopics: Array<{
    slug: string;
    title: string;
    category: ForumCategoryValue;
    status: string;
    createdAt: string;
  }>;
  forumReplies: Array<{
    id: string;
    body: string;
    createdAt: string;
    topic: { slug: string; title: string | null };
  }>;
}

export async function getCommunityProfile(address: string): Promise<PublicCommunityProfile | null> {
  try {
    const profile = await serverJson<PublicCommunityProfile>(
      `/v1/community/profiles/${encodeURIComponent(address)}`,
      'Community profile API',
    );
    return {
      ...profile,
      profile: profile.profile
        ? {
            ...profile.profile,
            avatarUrl: resolveApiAssetUrl(profile.profile.avatarUrl),
          }
        : null,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
