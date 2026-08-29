CREATE TYPE "SafePayoutProposalStatus" AS ENUM (
  'AWAITING_CONFIRMATIONS',
  'READY_TO_EXECUTE',
  'EXECUTED',
  'STALE',
  'FAILED'
);

CREATE TABLE "SafePayoutIntent" (
  "id" UUID NOT NULL,
  "payoutId" UUID NOT NULL,
  "goalId" UUID NOT NULL,
  "chainId" INTEGER NOT NULL,
  "safeAddress" TEXT NOT NULL,
  "safeNonce" TEXT NOT NULL,
  "toAddress" TEXT NOT NULL,
  "valueRaw" TEXT NOT NULL DEFAULT '0',
  "data" TEXT NOT NULL,
  "createdByAddress" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SafePayoutIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafePayoutProposal" (
  "id" UUID NOT NULL,
  "intentId" UUID NOT NULL,
  "safeTxHash" TEXT NOT NULL,
  "safeNonce" TEXT NOT NULL,
  "senderAddress" TEXT NOT NULL,
  "confirmations" INTEGER NOT NULL DEFAULT 1,
  "threshold" INTEGER NOT NULL,
  "status" "SafePayoutProposalStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATIONS',
  "executionTxHash" TEXT,
  "failureReason" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SafePayoutProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafePayoutIntent_payoutId_key" ON "SafePayoutIntent"("payoutId");
CREATE INDEX "SafePayoutIntent_goalId_createdAt_idx" ON "SafePayoutIntent"("goalId", "createdAt");
CREATE INDEX "SafePayoutIntent_chainId_safeAddress_expiresAt_idx" ON "SafePayoutIntent"("chainId", "safeAddress", "expiresAt");
CREATE INDEX "SafePayoutIntent_chainId_safeAddress_safeNonce_idx" ON "SafePayoutIntent"("chainId", "safeAddress", "safeNonce");
CREATE INDEX "SafePayoutIntent_createdByAddress_createdAt_idx" ON "SafePayoutIntent"("createdByAddress", "createdAt");
CREATE UNIQUE INDEX "SafePayoutIntent_one_unsubmitted_per_safe_idx"
ON "SafePayoutIntent"("chainId", "safeAddress")
WHERE "consumedAt" IS NULL;

CREATE UNIQUE INDEX "SafePayoutProposal_intentId_key" ON "SafePayoutProposal"("intentId");
CREATE UNIQUE INDEX "SafePayoutProposal_safeTxHash_key" ON "SafePayoutProposal"("safeTxHash");
CREATE INDEX "SafePayoutProposal_status_updatedAt_idx" ON "SafePayoutProposal"("status", "updatedAt");
CREATE INDEX "SafePayoutProposal_safeNonce_status_idx" ON "SafePayoutProposal"("safeNonce", "status");

ALTER TABLE "SafePayoutIntent"
ADD CONSTRAINT "SafePayoutIntent_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafePayoutIntent"
ADD CONSTRAINT "SafePayoutIntent_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafePayoutProposal"
ADD CONSTRAINT "SafePayoutProposal_intentId_fkey"
FOREIGN KEY ("intentId") REFERENCES "SafePayoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
