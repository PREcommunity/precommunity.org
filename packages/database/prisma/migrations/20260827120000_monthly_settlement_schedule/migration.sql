ALTER TABLE "Expense"
ADD COLUMN "firstSettlementAtOverride" TIMESTAMP(3);

ALTER TABLE "FundingGoal"
ADD COLUMN "monthlyFirstSettlementAt" TIMESTAMP(3),
ADD COLUMN "monthlySettlementDay" SMALLINT;

ALTER TABLE "FundingGoal"
ADD CONSTRAINT "FundingGoal_monthlySettlementDay_check"
CHECK ("monthlySettlementDay" IS NULL OR "monthlySettlementDay" BETWEEN 1 AND 31);

CREATE INDEX "FundingGoalPeriod_endsAt_idx"
ON "FundingGoalPeriod"("endsAt");
