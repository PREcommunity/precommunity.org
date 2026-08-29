-- precommunity starts a chain-derived public projection while preserving legacy rows in place.
ALTER TYPE "ExpenseStatus" ADD VALUE IF NOT EXISTS 'PENDING_CHAIN';
CREATE TYPE "MetadataStatus" AS ENUM ('NOT_SET', 'AVAILABLE', 'UNAVAILABLE', 'INVALID');

DROP TABLE IF EXISTS "FiatPledge";
DROP TYPE IF EXISTS "PledgeStatus";

DELETE FROM "FundingTarget" WHERE "asset"::text = 'FIAT_PLEDGE';
CREATE TYPE "FundingAsset_precommunity" AS ENUM ('PRE', 'USDC');
ALTER TABLE "FundingTarget" ALTER COLUMN "asset" TYPE "FundingAsset_precommunity" USING ("asset"::text::"FundingAsset_precommunity");
ALTER TABLE "CryptoContribution" ALTER COLUMN "asset" TYPE "FundingAsset_precommunity" USING ("asset"::text::"FundingAsset_precommunity");
ALTER TABLE "Disbursement" ALTER COLUMN "asset" TYPE "FundingAsset_precommunity" USING ("asset"::text::"FundingAsset_precommunity");
DROP TYPE "FundingAsset";
ALTER TYPE "FundingAsset_precommunity" RENAME TO "FundingAsset";

ALTER TABLE "Expense"
  ADD COLUMN "deadline" TIMESTAMP(3),
  ADD COLUMN "metadataDocuments" JSONB,
  ADD COLUMN "pendingChainGoalId" TEXT;
CREATE UNIQUE INDEX "Expense_pendingChainGoalId_key" ON "Expense"("pendingChainGoalId");

ALTER TABLE "FundingGoal" RENAME COLUMN "nameSnapshot" TO "title";
ALTER TABLE "FundingGoal" RENAME COLUMN "purposeSnapshot" TO "description";
ALTER TABLE "FundingGoal" RENAME COLUMN "categorySnapshot" TO "legacyCategory";
ALTER TABLE "FundingGoal" RENAME COLUMN "discussionUrl" TO "legacyDiscussionUrl";
ALTER TABLE "FundingGoal"
  ALTER COLUMN "expenseId" DROP NOT NULL,
  ALTER COLUMN "legacyCategory" DROP NOT NULL,
  ALTER COLUMN "legacyDiscussionUrl" DROP NOT NULL,
  ADD COLUMN "chainId" INTEGER NOT NULL DEFAULT 84532,
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "deadline" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "metadataStatus" "MetadataStatus" NOT NULL DEFAULT 'NOT_SET',
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "creationTxHash" TEXT,
  ADD COLUMN "creationBlock" BIGINT,
  ADD COLUMN "creationBlockHash" TEXT;
UPDATE "FundingGoal" SET "slug" = 'legacy-' || replace("id"::text, '-', '');
ALTER TABLE "FundingGoal" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "FundingGoal" ALTER COLUMN "deadline" DROP DEFAULT;
ALTER TABLE "FundingGoal" DROP COLUMN "fiatTargetCents";
DROP INDEX IF EXISTS "FundingGoal_expenseId_monthStart_key";
CREATE UNIQUE INDEX "FundingGoal_slug_key" ON "FundingGoal"("slug");
CREATE INDEX "FundingGoal_chainId_creationBlock_idx" ON "FundingGoal"("chainId", "creationBlock");
CREATE INDEX "FundingGoal_expenseId_idx" ON "FundingGoal"("expenseId");

ALTER TABLE "Disbursement" DROP COLUMN IF EXISTS "safeTxHash";
ALTER TABLE "CryptoContribution" DROP CONSTRAINT IF EXISTS "CryptoContribution_goalId_fkey";
ALTER TABLE "CryptoContribution" ADD CONSTRAINT "CryptoContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Disbursement" DROP CONSTRAINT IF EXISTS "Disbursement_goalId_fkey";
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundingGoal" DROP CONSTRAINT IF EXISTS "FundingGoal_expenseId_fkey";
ALTER TABLE "FundingGoal" ADD CONSTRAINT "FundingGoal_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
