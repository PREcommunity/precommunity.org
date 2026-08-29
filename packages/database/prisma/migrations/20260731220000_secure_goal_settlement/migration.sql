ALTER TABLE "FundingGoal"
ADD COLUMN "preExpenseApprovedRaw" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "usdcExpenseApprovedRaw" TEXT NOT NULL DEFAULT '0';
