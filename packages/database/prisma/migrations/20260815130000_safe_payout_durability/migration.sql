ALTER TYPE "SafePayoutProposalStatus"
ADD VALUE IF NOT EXISTS 'SUBMITTING' BEFORE 'AWAITING_CONFIRMATIONS';

ALTER TABLE "SafePayoutIntent"
DROP CONSTRAINT "SafePayoutIntent_payoutId_fkey";

ALTER TABLE "SafePayoutIntent"
ADD CONSTRAINT "SafePayoutIntent_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SafePayoutIntent"
DROP CONSTRAINT "SafePayoutIntent_goalId_fkey";

ALTER TABLE "SafePayoutIntent"
ADD CONSTRAINT "SafePayoutIntent_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "FundingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
