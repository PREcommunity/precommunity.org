DROP INDEX IF EXISTS "FundingGoal_chainGoalId_key";
DROP INDEX IF EXISTS "FundingGoal_slug_key";

CREATE UNIQUE INDEX "FundingGoal_chainId_chainGoalId_key"
ON "FundingGoal"("chainId", "chainGoalId");

CREATE UNIQUE INDEX "FundingGoal_chainId_slug_key"
ON "FundingGoal"("chainId", "slug");
