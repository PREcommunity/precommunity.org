-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'CONTENT_ADMIN', 'FINANCE_ADMIN');

-- CreateEnum
CREATE TYPE "SponsorVisibility" AS ENUM ('PUBLIC', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "ExpenseCadence" AS ENUM ('ONE_TIME', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FundingAsset" AS ENUM ('PRE', 'USDC', 'FIAT_PLEDGE');

-- CreateEnum
CREATE TYPE "FundingGoalStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PledgeStatus" AS ENUM ('PENDING', 'ACTIVE', 'PROOF_SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DisbursementKind" AS ENUM ('EXPENSE', 'SURPLUS');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PROPOSED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT,
    "websiteUrl" TEXT,
    "avatarUrl" TEXT,
    "defaultVisibility" "SponsorVisibility" NOT NULL DEFAULT 'ANONYMOUS',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "nonceExpiresAt" TIMESTAMP(3) NOT NULL,
    "nonceUsedAt" TIMESTAMP(3),
    "sessionTokenHash" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subproject" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subproject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "subprojectId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cadence" "ExpenseCadence" NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientAddress" TEXT NOT NULL,
    "discussionUrl" TEXT NOT NULL,
    "metadataUri" TEXT,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingTarget" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "asset" "FundingAsset" NOT NULL,
    "amount" DECIMAL(78,18) NOT NULL,

    CONSTRAINT "FundingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingGoal" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "chainGoalId" TEXT NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "purposeSnapshot" TEXT NOT NULL,
    "categorySnapshot" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "discussionUrl" TEXT NOT NULL,
    "metadataUri" TEXT,
    "preTargetRaw" TEXT NOT NULL DEFAULT '0',
    "usdcTargetRaw" TEXT NOT NULL DEFAULT '0',
    "fiatTargetCents" INTEGER NOT NULL DEFAULT 0,
    "status" "FundingGoalStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoContribution" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "userId" UUID,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "asset" "FundingAsset" NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "visibility" "SponsorVisibility" NOT NULL DEFAULT 'ANONYMOUS',
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CryptoContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionDisclosure" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "visibility" "SponsorVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiatPledge" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "visibility" "SponsorVisibility" NOT NULL DEFAULT 'ANONYMOUS',
    "months" INTEGER NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "endMonth" TIMESTAMP(3) NOT NULL,
    "status" "PledgeStatus" NOT NULL DEFAULT 'PENDING',
    "proofReference" TEXT,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiatPledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "asset" "FundingAsset" NOT NULL,
    "kind" "DisbursementKind" NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "safeTxHash" TEXT,
    "chainTxHash" TEXT,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "actorAddress" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "key" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL,
    "lastBlockHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");
CREATE UNIQUE INDEX "SponsorProfile_userId_key" ON "SponsorProfile"("userId");
CREATE UNIQUE INDEX "WalletSession_sessionTokenHash_key" ON "WalletSession"("sessionTokenHash");
CREATE INDEX "WalletSession_address_nonceExpiresAt_idx" ON "WalletSession"("address", "nonceExpiresAt");
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE UNIQUE INDEX "Subproject_projectId_slug_key" ON "Subproject"("projectId", "slug");
CREATE UNIQUE INDEX "Expense_slug_key" ON "Expense"("slug");
CREATE UNIQUE INDEX "FundingTarget_expenseId_asset_key" ON "FundingTarget"("expenseId", "asset");
CREATE UNIQUE INDEX "FundingGoal_chainGoalId_key" ON "FundingGoal"("chainGoalId");
CREATE INDEX "FundingGoal_monthStart_status_idx" ON "FundingGoal"("monthStart", "status");
CREATE UNIQUE INDEX "FundingGoal_expenseId_monthStart_key" ON "FundingGoal"("expenseId", "monthStart");
CREATE INDEX "CryptoContribution_goalId_asset_idx" ON "CryptoContribution"("goalId", "asset");
CREATE INDEX "CryptoContribution_userId_idx" ON "CryptoContribution"("userId");
CREATE UNIQUE INDEX "CryptoContribution_chainId_txHash_logIndex_key" ON "CryptoContribution"("chainId", "txHash", "logIndex");
CREATE INDEX "ContributionDisclosure_userId_createdAt_idx" ON "ContributionDisclosure"("userId", "createdAt");
CREATE UNIQUE INDEX "ContributionDisclosure_chainId_txHash_userId_key" ON "ContributionDisclosure"("chainId", "txHash", "userId");
CREATE INDEX "FiatPledge_goalId_status_idx" ON "FiatPledge"("goalId", "status");
CREATE INDEX "Disbursement_goalId_status_idx" ON "Disbursement"("goalId", "status");
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX "ChainEvent_chainId_blockNumber_idx" ON "ChainEvent"("chainId", "blockNumber");
CREATE UNIQUE INDEX "ChainEvent_chainId_txHash_logIndex_key" ON "ChainEvent"("chainId", "txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "SponsorProfile" ADD CONSTRAINT "SponsorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletSession" ADD CONSTRAINT "WalletSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subproject" ADD CONSTRAINT "Subproject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_subprojectId_fkey" FOREIGN KEY ("subprojectId") REFERENCES "Subproject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundingTarget" ADD CONSTRAINT "FundingTarget_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundingGoal" ADD CONSTRAINT "FundingGoal_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoContribution" ADD CONSTRAINT "CryptoContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoContribution" ADD CONSTRAINT "CryptoContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContributionDisclosure" ADD CONSTRAINT "ContributionDisclosure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiatPledge" ADD CONSTRAINT "FiatPledge_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiatPledge" ADD CONSTRAINT "FiatPledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
