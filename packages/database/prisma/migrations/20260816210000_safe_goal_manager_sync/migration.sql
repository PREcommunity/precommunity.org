CREATE TYPE "GoalManagerAssignmentSource" AS ENUM ('SAFE_OWNER', 'MANUAL');

CREATE TYPE "SafeGoalManagerProposalStatus" AS ENUM (
  'SUBMITTING',
  'AWAITING_CONFIRMATIONS',
  'READY_TO_EXECUTE',
  'EXECUTED',
  'STALE',
  'FAILED'
);

CREATE TABLE "GoalManagerAssignment" (
  "id" UUID NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "source" "GoalManagerAssignmentSource" NOT NULL,
  "desiredEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoalManagerAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoalManagerAssignment_chainId_contractAddress_address_source_key"
ON "GoalManagerAssignment"("chainId", "contractAddress", "address", "source");
CREATE INDEX "GoalManagerAssignment_chainId_contractAddress_source_desiredEnabled_idx"
ON "GoalManagerAssignment"("chainId", "contractAddress", "source", "desiredEnabled");
CREATE INDEX "GoalManagerAssignment_chainId_contractAddress_address_idx"
ON "GoalManagerAssignment"("chainId", "contractAddress", "address");

CREATE TABLE "SafeGoalManagerIntent" (
  "id" UUID NOT NULL,
  "chainId" INTEGER NOT NULL,
  "safeAddress" TEXT NOT NULL,
  "safeNonce" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "desiredStateHash" TEXT NOT NULL,
  "createdByAddress" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafeGoalManagerIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SafeGoalManagerIntent_chainId_safeAddress_expiresAt_idx"
ON "SafeGoalManagerIntent"("chainId", "safeAddress", "expiresAt");
CREATE INDEX "SafeGoalManagerIntent_chainId_safeAddress_safeNonce_idx"
ON "SafeGoalManagerIntent"("chainId", "safeAddress", "safeNonce");
CREATE INDEX "SafeGoalManagerIntent_createdByAddress_createdAt_idx"
ON "SafeGoalManagerIntent"("createdByAddress", "createdAt");

CREATE TABLE "SafeGoalManagerProposal" (
  "id" UUID NOT NULL,
  "intentId" UUID NOT NULL,
  "activeKey" TEXT,
  "safeTxHash" TEXT NOT NULL,
  "safeNonce" TEXT NOT NULL,
  "senderAddress" TEXT NOT NULL,
  "confirmations" INTEGER NOT NULL DEFAULT 1,
  "threshold" INTEGER NOT NULL,
  "status" "SafeGoalManagerProposalStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATIONS',
  "executionTxHash" TEXT,
  "failureReason" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafeGoalManagerProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafeGoalManagerProposal_intentId_key" ON "SafeGoalManagerProposal"("intentId");
CREATE UNIQUE INDEX "SafeGoalManagerProposal_activeKey_key" ON "SafeGoalManagerProposal"("activeKey");
CREATE UNIQUE INDEX "SafeGoalManagerProposal_safeTxHash_key" ON "SafeGoalManagerProposal"("safeTxHash");
CREATE INDEX "SafeGoalManagerProposal_status_updatedAt_idx" ON "SafeGoalManagerProposal"("status", "updatedAt");
CREATE INDEX "SafeGoalManagerProposal_safeNonce_status_idx" ON "SafeGoalManagerProposal"("safeNonce", "status");

ALTER TABLE "SafeGoalManagerProposal"
ADD CONSTRAINT "SafeGoalManagerProposal_intentId_fkey"
FOREIGN KEY ("intentId") REFERENCES "SafeGoalManagerIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
