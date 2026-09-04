ALTER TABLE "Expense" ADD COLUMN "previewToken" TEXT;

CREATE UNIQUE INDEX "Expense_previewToken_key" ON "Expense"("previewToken");
