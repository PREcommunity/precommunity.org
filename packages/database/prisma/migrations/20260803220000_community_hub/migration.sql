-- CreateEnum
CREATE TYPE "CommunityProposalStatus" AS ENUM ('PENDING_REVIEW', 'VOTING', 'PASSED', 'REJECTED', 'CONVERTED', 'DECLINED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProposalVoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- AlterTable
ALTER TABLE "SponsorProfile" ADD COLUMN "bio" TEXT,
ADD COLUMN "socialLinks" JSONB;

-- CreateTable
CREATE TABLE "CommunityProposal" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "CommunityProposalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "snapshotBlock" BIGINT,
    "votingStartsAt" TIMESTAMP(3),
    "votingEndsAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderationNote" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalComment" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProposalComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVote" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "choice" "ProposalVoteChoice" NOT NULL,
    "weightRaw" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProposalVote_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "communityProposalId" UUID;

CREATE UNIQUE INDEX "CommunityProposal_slug_key" ON "CommunityProposal"("slug");
CREATE INDEX "CommunityProposal_status_createdAt_idx" ON "CommunityProposal"("status", "createdAt");
CREATE INDEX "CommunityProposal_authorId_createdAt_idx" ON "CommunityProposal"("authorId", "createdAt");
CREATE INDEX "CommunityProposal_category_status_idx" ON "CommunityProposal"("category", "status");
CREATE INDEX "ProposalComment_proposalId_createdAt_idx" ON "ProposalComment"("proposalId", "createdAt");
CREATE INDEX "ProposalComment_authorId_createdAt_idx" ON "ProposalComment"("authorId", "createdAt");
CREATE UNIQUE INDEX "ProposalVote_proposalId_userId_key" ON "ProposalVote"("proposalId", "userId");
CREATE INDEX "ProposalVote_proposalId_choice_idx" ON "ProposalVote"("proposalId", "choice");
CREATE INDEX "ProposalVote_userId_createdAt_idx" ON "ProposalVote"("userId", "createdAt");
CREATE UNIQUE INDEX "Expense_communityProposalId_key" ON "Expense"("communityProposalId");

ALTER TABLE "CommunityProposal" ADD CONSTRAINT "CommunityProposal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProposalComment" ADD CONSTRAINT "ProposalComment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommunityProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalComment" ADD CONSTRAINT "ProposalComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommunityProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_communityProposalId_fkey" FOREIGN KEY ("communityProposalId") REFERENCES "CommunityProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
