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
import { CommunityProposalStatus, ForumTopicStatus, Prisma } from '@precommunity/database';
import { getAddress } from 'viem';
import { PROJECT_SLUG } from '@precommunity/shared';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { profileAvatarPath, visibleProfile } from '../common/public-profile';
import { PrismaService } from '../common/prisma.service';
import { createSlug } from '../common/slug';
import { writeAuditEvent } from '../common/audit';
import {
  CommentDto,
  CreateProposalDto,
  ModerationDto,
  ProposalSettingsDto,
  UpdateProposalDto,
  VoteDto,
} from './community.dto';
import {
  aggregateProposalVoteTotals,
  proposalDetailInclude,
  proposalSummaryInclude,
  serializeCommunityProposal,
} from './community-presenter';
import { TokenEligibilityService } from './token-eligibility.service';

const VOTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CommunityService {
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

  private async proposal(where: Prisma.CommunityProposalWhereUniqueInput) {
    const proposal = await this.prisma.communityProposal.findUnique({
      where,
      include: proposalDetailInclude,
    });
    if (!proposal || proposal.status === CommunityProposalStatus.REMOVED)
      throw new NotFoundException('Community proposal not found');
    return proposal;
  }

  async closeExpired(id?: string) {
    const expired = await this.prisma.communityProposal.findMany({
      where: { id, status: CommunityProposalStatus.VOTING, votingEndsAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const candidate of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "CommunityProposal" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
        const proposal = await tx.communityProposal.findUnique({ where: { id: candidate.id } });
        const now = new Date();
        if (
          !proposal ||
          proposal.status !== CommunityProposalStatus.VOTING ||
          !proposal.votingEndsAt ||
          proposal.votingEndsAt > now
        )
          return;
        const totals = (await aggregateProposalVoteTotals(tx, [proposal.id])).get(proposal.id)!;
        const status =
          BigInt(totals.forRaw) > BigInt(totals.againstRaw)
            ? CommunityProposalStatus.PASSED
            : CommunityProposalStatus.REJECTED;
        await tx.communityProposal.update({
          where: { id: proposal.id },
          data: { status, closedAt: now },
        });
      });
    }
  }

  async list(status?: CommunityProposalStatus, category?: string) {
    await this.closeExpired();
    if (
      status === CommunityProposalStatus.PENDING_REVIEW ||
      status === CommunityProposalStatus.REMOVED
    )
      return [];
    const proposals = await this.prisma.communityProposal.findMany({
      where: {
        status: status ?? {
          notIn: [CommunityProposalStatus.PENDING_REVIEW, CommunityProposalStatus.REMOVED],
        },
        category: category || undefined,
      },
      include: proposalSummaryInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    const totals = await aggregateProposalVoteTotals(
      this.prisma,
      proposals.map((proposal) => proposal.id),
    );
    return proposals.map((proposal) =>
      serializeCommunityProposal(proposal, totals.get(proposal.id)),
    );
  }

  async get(slug: string) {
    await this.closeExpired();
    const proposal = await this.proposal({ slug });
    if (proposal.status === CommunityProposalStatus.PENDING_REVIEW)
      throw new NotFoundException('Community proposal not found');
    const totals = await aggregateProposalVoteTotals(this.prisma, [proposal.id]);
    return serializeCommunityProposal(proposal, totals.get(proposal.id), true);
  }

  async mine(actor: AuthenticatedPrincipal) {
    const proposals = await this.prisma.communityProposal.findMany({
      where: { authorId: actor.userId },
      include: proposalDetailInclude,
      orderBy: { createdAt: 'desc' },
    });
    const totals = await aggregateProposalVoteTotals(
      this.prisma,
      proposals.map((proposal) => proposal.id),
    );
    return proposals.map((proposal) =>
      serializeCommunityProposal(proposal, totals.get(proposal.id), true),
    );
  }

  async membership(address: string) {
    return this.eligibility.status(address);
  }

  async create(dto: CreateProposalDto, actor: AuthenticatedPrincipal) {
    await this.eligibility.assertCurrent(actor.address);
    const project = await this.project();
    const create = (snapshotBlock?: bigint) =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR SHARE`;
        const settings = await tx.communitySettings.findUnique({
          where: { projectId: project.id },
        });
        const moderated = settings?.proposalModerationEnabled ?? true;
        if (!moderated && snapshotBlock === undefined) return null;
        const now = new Date();
        await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
        const since = new Date(Date.now() - 60 * 60 * 1000);
        if (
          (await tx.communityProposal.count({
            where: { authorId: actor.userId, createdAt: { gte: since } },
          })) >= 3
        ) {
          throw new HttpException(
            'Proposal limit reached; try again later',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return tx.communityProposal.create({
          data: {
            authorId: actor.userId,
            slug: createSlug(dto.title, 'proposal'),
            title: dto.title.trim(),
            description: dto.description.trim(),
            category: dto.category.trim(),
            status: moderated
              ? CommunityProposalStatus.PENDING_REVIEW
              : CommunityProposalStatus.VOTING,
            snapshotBlock: moderated ? undefined : snapshotBlock,
            votingStartsAt: moderated ? undefined : now,
            votingEndsAt: moderated ? undefined : new Date(now.getTime() + VOTING_WINDOW_MS),
          },
          include: proposalDetailInclude,
        });
      });
    let proposal = await create();
    if (!proposal) proposal = await create(await this.eligibility.confirmedSnapshotBlock());
    if (!proposal) throw new ConflictException('Proposal review settings changed; try again');
    return serializeCommunityProposal(proposal, undefined, true);
  }

  async update(id: string, dto: UpdateProposalDto, actor: AuthenticatedPrincipal) {
    await this.eligibility.assertCurrent(actor.address);
    const proposal = await this.prisma.communityProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Community proposal not found');
    if (proposal.authorId !== actor.userId)
      throw new ForbiddenException('Only the author can edit this proposal');
    if (proposal.status !== CommunityProposalStatus.PENDING_REVIEW)
      throw new ConflictException('A proposal is frozen after voting review');
    const updated = await this.prisma.communityProposal.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        category: dto.category?.trim(),
      },
      include: proposalDetailInclude,
    });
    return serializeCommunityProposal(updated, undefined, true);
  }

  async comment(proposalId: string, dto: CommentDto, actor: AuthenticatedPrincipal) {
    await this.eligibility.assertCurrent(actor.address);
    const proposal = await this.proposal({ id: proposalId });
    if (proposal.status === CommunityProposalStatus.PENDING_REVIEW)
      throw new ConflictException('Discussion opens after the proposal passes content review');
    const since = new Date(Date.now() - 60_000);
    if (
      (await this.prisma.proposalComment.count({
        where: { authorId: actor.userId, createdAt: { gte: since } },
      })) >= 10
    ) {
      throw new HttpException(
        'Comment limit reached; wait a moment before posting again',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.prisma.proposalComment.create({
      data: { proposalId, authorId: actor.userId, body: dto.body.trim() },
    });
  }

  async editComment(id: string, dto: CommentDto, actor: AuthenticatedPrincipal) {
    await this.eligibility.assertCurrent(actor.address);
    const comment = await this.prisma.proposalComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== actor.userId)
      throw new ForbiddenException('Only the author can edit this comment');
    if (comment.deletedAt || comment.removedAt)
      throw new ConflictException('A deleted comment cannot be edited');
    return this.prisma.proposalComment.update({
      where: { id },
      data: { body: dto.body.trim(), editedAt: new Date() },
    });
  }

  async deleteComment(id: string, actor: AuthenticatedPrincipal) {
    await this.eligibility.assertCurrent(actor.address);
    const comment = await this.prisma.proposalComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== actor.userId)
      throw new ForbiddenException('Only the author can delete this comment');
    return this.prisma.proposalComment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async vote(proposalId: string, dto: VoteDto, actor: AuthenticatedPrincipal) {
    await this.closeExpired(proposalId);
    const proposal = await this.prisma.communityProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundException('Community proposal not found');
    if (
      proposal.status !== CommunityProposalStatus.VOTING ||
      !proposal.snapshotBlock ||
      !proposal.votingEndsAt ||
      proposal.votingEndsAt <= new Date()
    ) {
      throw new ConflictException('Voting is not open for this proposal');
    }
    const weight = await this.eligibility.snapshotBalance(actor.address, proposal.snapshotBlock);
    this.eligibility.assertSnapshotEligible(weight);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "CommunityProposal" WHERE "id" = ${proposalId}::uuid FOR UPDATE`;
      const current = await tx.communityProposal.findUnique({ where: { id: proposalId } });
      if (
        !current ||
        current.status !== CommunityProposalStatus.VOTING ||
        !current.snapshotBlock ||
        current.snapshotBlock !== proposal.snapshotBlock ||
        !current.votingEndsAt ||
        current.votingEndsAt <= new Date()
      ) {
        throw new ConflictException('Voting is not open for this proposal');
      }
      const currentVote = await tx.proposalVote.findUnique({
        where: { proposalId_userId: { proposalId, userId: actor.userId } },
      });
      if (currentVote && Date.now() - currentVote.updatedAt.getTime() < 2_000) {
        throw new HttpException(
          'Wait a moment before changing your vote again',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return tx.proposalVote.upsert({
        where: { proposalId_userId: { proposalId, userId: actor.userId } },
        update: { choice: dto.choice },
        create: {
          proposalId,
          userId: actor.userId,
          choice: dto.choice,
          weightRaw: weight.toString(),
        },
      });
    });
  }

  async openVoting(id: string, dto: ModerationDto, actor: AuthenticatedPrincipal) {
    const block = await this.eligibility.confirmedSnapshotBlock();
    const now = new Date();
    const result = await this.prisma.communityProposal.updateMany({
      where: { id, status: CommunityProposalStatus.PENDING_REVIEW },
      data: {
        status: CommunityProposalStatus.VOTING,
        snapshotBlock: block,
        votingStartsAt: now,
        votingEndsAt: new Date(now.getTime() + VOTING_WINDOW_MS),
        moderatedBy: actor.address,
        moderationNote: dto.note ?? null,
      },
    });
    if (result.count !== 1)
      throw new ConflictException('Only a pending proposal can be opened for voting');
    return this.getByIdForAdmin(id);
  }

  async decline(id: string, dto: ModerationDto, actor: AuthenticatedPrincipal) {
    const result = await this.prisma.communityProposal.updateMany({
      where: {
        id,
        status: {
          in: [
            CommunityProposalStatus.PENDING_REVIEW,
            CommunityProposalStatus.PASSED,
            CommunityProposalStatus.REJECTED,
          ],
        },
      },
      data: {
        status: CommunityProposalStatus.DECLINED,
        moderatedBy: actor.address,
        moderationNote: dto.note ?? null,
        closedAt: new Date(),
      },
    });
    if (result.count !== 1)
      throw new ConflictException('This proposal cannot be declined in its current state');
    return this.getByIdForAdmin(id);
  }

  async remove(id: string, dto: ModerationDto, actor: AuthenticatedPrincipal) {
    const result = await this.prisma.communityProposal.updateMany({
      where: { id, status: { not: CommunityProposalStatus.CONVERTED } },
      data: {
        status: CommunityProposalStatus.REMOVED,
        moderatedBy: actor.address,
        moderationNote: dto.note ?? null,
        removedAt: new Date(),
      },
    });
    if (result.count !== 1) throw new ConflictException('A converted proposal cannot be removed');
    return { ok: true };
  }

  async removeComment(id: string) {
    try {
      return await this.prisma.proposalComment.update({
        where: { id },
        data: { removedAt: new Date() },
      });
    } catch {
      throw new NotFoundException('Comment not found');
    }
  }

  async moderationQueue() {
    await this.closeExpired();
    const proposals = await this.prisma.communityProposal.findMany({
      include: proposalDetailInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const totals = await aggregateProposalVoteTotals(
      this.prisma,
      proposals.map((proposal) => proposal.id),
    );
    const project = await this.project();
    const settings = await this.prisma.communitySettings.findUnique({
      where: { projectId: project.id },
    });
    return {
      config: { proposalModerationEnabled: settings?.proposalModerationEnabled ?? true },
      proposals: proposals.map((proposal) =>
        serializeCommunityProposal(proposal, totals.get(proposal.id), true),
      ),
    };
  }

  async updateSettings(dto: ProposalSettingsDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR UPDATE`;
      const before = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const settings = await tx.communitySettings.upsert({
        where: { projectId: project.id },
        update: {
          proposalModerationEnabled: dto.proposalModerationEnabled,
          updatedBy: actor.address,
        },
        create: {
          projectId: project.id,
          proposalModerationEnabled: dto.proposalModerationEnabled,
          updatedBy: actor.address,
        },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'CommunitySettings',
        entityId: project.id,
        action: 'UPDATE_PROPOSAL_MODERATION',
        before: { proposalModerationEnabled: before?.proposalModerationEnabled ?? true },
        after: { proposalModerationEnabled: settings.proposalModerationEnabled },
      });
      return { proposalModerationEnabled: settings.proposalModerationEnabled };
    });
  }

  private async getByIdForAdmin(id: string) {
    const proposal = await this.prisma.communityProposal.findUnique({
      where: { id },
      include: proposalDetailInclude,
    });
    if (!proposal) throw new NotFoundException('Community proposal not found');
    const totals = await aggregateProposalVoteTotals(this.prisma, [proposal.id]);
    return serializeCommunityProposal(proposal, totals.get(proposal.id), true);
  }

  async publicProfile(address: string) {
    let normalized: string;
    try {
      normalized = getAddress(address).toLowerCase();
    } catch {
      throw new BadRequestException('A valid wallet address is required');
    }
    const user = await this.prisma.user.findUnique({
      where: { address: normalized },
      include: {
        profile: true,
        proposals: {
          where: {
            status: {
              notIn: [CommunityProposalStatus.PENDING_REVIEW, CommunityProposalStatus.REMOVED],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { slug: true, title: true, status: true, createdAt: true },
        },
        comments: {
          where: {
            deletedAt: null,
            removedAt: null,
            proposal: { status: { not: CommunityProposalStatus.REMOVED } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            body: true,
            createdAt: true,
            proposal: { select: { slug: true, title: true } },
          },
        },
        proposalVotes: {
          where: { proposal: { status: { not: CommunityProposalStatus.REMOVED } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            choice: true,
            weightRaw: true,
            createdAt: true,
            proposal: { select: { slug: true, title: true, status: true } },
          },
        },
        forumTopics: {
          where: {
            status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] },
            deletedAt: null,
            removedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { slug: true, title: true, category: true, status: true, createdAt: true },
        },
        forumReplies: {
          where: {
            deletedAt: null,
            removedAt: null,
            topic: {
              status: { in: [ForumTopicStatus.PUBLISHED, ForumTopicStatus.LOCKED] },
              deletedAt: null,
              removedAt: null,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            body: true,
            createdAt: true,
            topic: {
              select: { id: true, slug: true, title: true, deletedAt: true, removedAt: true },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Community member not found');
    const profile = visibleProfile(user.profile);
    return {
      address: user.address,
      profile: profile
        ? {
            active: true,
            revision: profile.revision.toString(),
            displayName: profile.displayName,
            avatarUrl: profileAvatarPath(user.address, profile),
            websiteUrl: profile.websiteUrl?.startsWith('https://') ? profile.websiteUrl : null,
            bio: profile.bio,
            defaultPublic: profile.defaultPublic,
          }
        : null,
      proposals: user.proposals,
      comments: user.comments,
      votes: user.proposalVotes,
      forumTopics: user.forumTopics,
      forumReplies: user.forumReplies.map((reply) => ({
        ...reply,
        topic: {
          slug: reply.topic.deletedAt || reply.topic.removedAt ? reply.topic.id : reply.topic.slug,
          title: reply.topic.deletedAt || reply.topic.removedAt ? null : reply.topic.title,
        },
      })),
    };
  }
}
