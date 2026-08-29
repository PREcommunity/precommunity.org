ALTER TYPE "DisbursementKind" RENAME TO "PayoutKind";
ALTER TYPE "DisbursementStatus" RENAME TO "PayoutStatus";

ALTER TABLE "Disbursement" RENAME TO "Payout";
ALTER TABLE "Payout" RENAME CONSTRAINT "Disbursement_pkey" TO "Payout_pkey";
ALTER TABLE "Payout" RENAME CONSTRAINT "Disbursement_goalId_fkey" TO "Payout_goalId_fkey";
ALTER INDEX "Disbursement_goalId_status_idx" RENAME TO "Payout_goalId_status_idx";
