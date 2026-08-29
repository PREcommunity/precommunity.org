ALTER TABLE "FundingGoal"
RENAME COLUMN "preExpenseApprovedRaw" TO "preRecipientEntitlementRaw";

ALTER TABLE "FundingGoal"
RENAME COLUMN "usdcExpenseApprovedRaw" TO "usdcRecipientEntitlementRaw";
