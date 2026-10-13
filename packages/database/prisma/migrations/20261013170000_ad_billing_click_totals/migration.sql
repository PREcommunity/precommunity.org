CREATE TABLE "AdBillingClickTotals" (
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "billableClicks" BIGINT NOT NULL DEFAULT 0,
    "suppressedClicks" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdBillingClickTotals_pkey" PRIMARY KEY ("chainId", "contractAddress")
);
