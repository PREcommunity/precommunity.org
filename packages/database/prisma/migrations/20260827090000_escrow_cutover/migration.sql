CREATE TYPE "FundingGoalType" AS ENUM ('ONE_TIME', 'MONTHLY');
CREATE TYPE "MonthlySurplusPolicy" AS ENUM ('PAYOUT_ALL', 'ROLL_OVER');
CREATE TYPE "SafeGoalActionKind" AS ENUM (
  'CLOSE_ONE_TIME',
  'CANCEL_ONE_TIME',
  'SET_MONTHLY_SURPLUS_POLICY',
  'REQUEST_MONTHLY_STOP',
  'CANCEL_MONTHLY'
);
CREATE TYPE "SafeGoalActionProposalStatus" AS ENUM (
  'SUBMITTING',
  'AWAITING_CONFIRMATIONS',
  'READY_TO_EXECUTE',
  'EXECUTED',
  'STALE',
  'FAILED'
);

ALTER TYPE "PayoutKind" RENAME VALUE 'SURPLUS' TO 'CANCELLED_FUNDS';

ALTER TABLE "Expense"
ADD COLUMN "monthlySurplusPolicy" "MonthlySurplusPolicy";

ALTER TABLE "FundingGoal"
ADD COLUMN "creatorAddress" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
ADD COLUMN "goalType" "FundingGoalType" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN "monthlySurplusPolicy" "MonthlySurplusPolicy",
ADD COLUMN "monthlyStopRequestedAt" TIMESTAMP(3),
ADD COLUMN "monthlyPeriodsSettled" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "preCarryRaw" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "usdcCarryRaw" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "preTreasuryEntitlementRaw" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "usdcTreasuryEntitlementRaw" TEXT NOT NULL DEFAULT '0';

ALTER TABLE "FundingGoal"
ALTER COLUMN "creatorAddress" DROP DEFAULT;

CREATE TABLE "FundingGoalPeriod" (
  "id" UUID NOT NULL,
  "goalId" UUID NOT NULL,
  "periodIndex" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "surplusPolicy" "MonthlySurplusPolicy" NOT NULL,
  "finalPeriod" BOOLEAN NOT NULL DEFAULT false,
  "preContributedRaw" TEXT NOT NULL DEFAULT '0',
  "usdcContributedRaw" TEXT NOT NULL DEFAULT '0',
  "preCarryInRaw" TEXT NOT NULL DEFAULT '0',
  "usdcCarryInRaw" TEXT NOT NULL DEFAULT '0',
  "preRecipientEntitlementAddedRaw" TEXT NOT NULL DEFAULT '0',
  "usdcRecipientEntitlementAddedRaw" TEXT NOT NULL DEFAULT '0',
  "preCarryOutRaw" TEXT NOT NULL DEFAULT '0',
  "usdcCarryOutRaw" TEXT NOT NULL DEFAULT '0',
  "settlementTxHash" TEXT,
  "settlementBlock" BIGINT,
  "settlementBlockHash" TEXT,
  "settlementLogIndex" INTEGER,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FundingGoalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundingGoalPeriod_goalId_periodIndex_key"
ON "FundingGoalPeriod"("goalId", "periodIndex");
CREATE INDEX "FundingGoalPeriod_goalId_startsAt_idx"
ON "FundingGoalPeriod"("goalId", "startsAt");
CREATE INDEX "FundingGoalPeriod_startsAt_endsAt_idx"
ON "FundingGoalPeriod"("startsAt", "endsAt");

ALTER TABLE "FundingGoalPeriod"
ADD CONSTRAINT "FundingGoalPeriod_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SafeGoalActionIntent" (
  "id" UUID NOT NULL,
  "goalId" UUID NOT NULL,
  "kind" "SafeGoalActionKind" NOT NULL,
  "parameters" JSONB,
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

  CONSTRAINT "SafeGoalActionIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafeGoalActionProposal" (
  "id" UUID NOT NULL,
  "intentId" UUID NOT NULL,
  "safeTxHash" TEXT NOT NULL,
  "safeNonce" TEXT NOT NULL,
  "senderAddress" TEXT NOT NULL,
  "confirmations" INTEGER NOT NULL DEFAULT 1,
  "threshold" INTEGER NOT NULL,
  "status" "SafeGoalActionProposalStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATIONS',
  "executionTxHash" TEXT,
  "failureReason" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SafeGoalActionProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SafeGoalActionIntent_goalId_createdAt_idx"
ON "SafeGoalActionIntent"("goalId", "createdAt");
CREATE INDEX "SafeGoalActionIntent_chainId_safeAddress_expiresAt_idx"
ON "SafeGoalActionIntent"("chainId", "safeAddress", "expiresAt");
CREATE INDEX "SafeGoalActionIntent_chainId_safeAddress_safeNonce_idx"
ON "SafeGoalActionIntent"("chainId", "safeAddress", "safeNonce");
CREATE INDEX "SafeGoalActionIntent_createdByAddress_createdAt_idx"
ON "SafeGoalActionIntent"("createdByAddress", "createdAt");
CREATE UNIQUE INDEX "SafeGoalActionIntent_one_unsubmitted_per_safe_idx"
ON "SafeGoalActionIntent"("chainId", "safeAddress")
WHERE "consumedAt" IS NULL;

CREATE UNIQUE INDEX "SafeGoalActionProposal_intentId_key"
ON "SafeGoalActionProposal"("intentId");
CREATE UNIQUE INDEX "SafeGoalActionProposal_safeTxHash_key"
ON "SafeGoalActionProposal"("safeTxHash");
CREATE INDEX "SafeGoalActionProposal_status_updatedAt_idx"
ON "SafeGoalActionProposal"("status", "updatedAt");
CREATE INDEX "SafeGoalActionProposal_safeNonce_status_idx"
ON "SafeGoalActionProposal"("safeNonce", "status");

ALTER TABLE "SafeGoalActionIntent"
ADD CONSTRAINT "SafeGoalActionIntent_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SafeGoalActionProposal"
ADD CONSTRAINT "SafeGoalActionProposal_intentId_fkey"
FOREIGN KEY ("intentId") REFERENCES "SafeGoalActionIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
