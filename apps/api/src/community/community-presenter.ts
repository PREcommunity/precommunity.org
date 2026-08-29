import { CommunityProposalStatus, Prisma, ProposalVoteChoice } from '@precommunity/database';
import type { ProfileProjection } from '../common/public-profile';
import { publicAuthorProfile } from '../common/public-profile';

function publicAuthor(user: { address: string; profile: ProfileProjection | null }) {
  return publicAuthorProfile(user.address, user.profile);
}

export const proposalSummaryInclude = {
  author: { include: { profile: true } },
  convertedExpense: { select: { id: true, slug: true, status: true } },
} satisfies Prisma.CommunityProposalInclude;

export const proposalDetailInclude = {
  ...proposalSummaryInclude,
  comments: {
    include: { author: { include: { profile: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.CommunityProposalInclude;

type ProposalSummaryWithRelations = Prisma.CommunityProposalGetPayload<{
  include: typeof proposalSummaryInclude;
}>;
type ProposalDetailWithRelations = Prisma.CommunityProposalGetPayload<{
  include: typeof proposalDetailInclude;
}>;

interface ProposalVoteTotals {
  forRaw: string;
  againstRaw: string;
  abstainRaw: string;
  voterCount: number;
}

interface ProposalVoteAggregateRow {
  proposalId: string;
  choice: ProposalVoteChoice;
  weightRaw: string;
  voterCount: number;
}

type VoteAggregateClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

function emptyVoteTotals(): ProposalVoteTotals {
  return { forRaw: '0', againstRaw: '0', abstainRaw: '0', voterCount: 0 };
}

export async function aggregateProposalVoteTotals(
  client: VoteAggregateClient,
  proposalIds: string[],
) {
  const totals = new Map(proposalIds.map((id) => [id, emptyVoteTotals()]));
  if (!proposalIds.length) return totals;
  const rows = await client.$queryRaw<ProposalVoteAggregateRow[]>(Prisma.sql`
    SELECT
      "proposalId",
      "choice",
      SUM("weightRaw"::numeric)::text AS "weightRaw",
      COUNT(*)::int AS "voterCount"
    FROM "ProposalVote"
    WHERE "proposalId" IN (${Prisma.join(proposalIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY "proposalId", "choice"
  `);
  for (const row of rows) {
    const current = totals.get(row.proposalId);
    if (!current) continue;
    if (row.choice === ProposalVoteChoice.FOR) current.forRaw = row.weightRaw;
    else if (row.choice === ProposalVoteChoice.AGAINST) current.againstRaw = row.weightRaw;
    else current.abstainRaw = row.weightRaw;
    current.voterCount += Number(row.voterCount);
  }
  return totals;
}

export function serializeCommunityProposal(
  proposal: ProposalSummaryWithRelations | ProposalDetailWithRelations,
  results: ProposalVoteTotals = emptyVoteTotals(),
  detail = false,
) {
  const comments = 'comments' in proposal ? proposal.comments : [];
  return {
    id: proposal.id,
    slug: proposal.slug,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    status: proposal.status,
    snapshotBlock: proposal.snapshotBlock?.toString() ?? null,
    votingStartsAt: proposal.votingStartsAt?.toISOString() ?? null,
    votingEndsAt: proposal.votingEndsAt?.toISOString() ?? null,
    closedAt: proposal.closedAt?.toISOString() ?? null,
    moderationNote:
      proposal.status === CommunityProposalStatus.DECLINED ? proposal.moderationNote : null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    author: publicAuthor(proposal.author),
    results,
    convertedExpense: proposal.convertedExpense,
    comments: detail
      ? comments.map((comment) => ({
          id: comment.id,
          body: comment.deletedAt || comment.removedAt ? null : comment.body,
          state: comment.removedAt ? 'REMOVED' : comment.deletedAt ? 'DELETED' : 'ACTIVE',
          editedAt: comment.editedAt?.toISOString() ?? null,
          createdAt: comment.createdAt.toISOString(),
          author: publicAuthor(comment.author),
        }))
      : undefined,
  };
}
