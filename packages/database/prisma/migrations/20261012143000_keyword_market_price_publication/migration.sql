CREATE TABLE "AdPricePublication" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "quoteId" UUID,
    "priceE18Raw" TEXT NOT NULL,
    "quotedAt" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "signerAddress" TEXT,
    "nonce" BIGINT,
    "txHash" TEXT,
    "signedTransaction" TEXT,
    "receiptBlockNumber" BIGINT,
    "receiptBlockHash" TEXT,
    "errorCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdPricePublication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdPricePublication_chainId_signerAddress_nonce_key" ON "AdPricePublication"("chainId", "signerAddress", "nonce");
CREATE UNIQUE INDEX "AdPricePublication_chainId_contractAddress_quotedAt_key" ON "AdPricePublication"("chainId", "contractAddress", "quotedAt");
CREATE INDEX "AdPricePublication_chainId_signerAddress_status_idx" ON "AdPricePublication"("chainId", "signerAddress", "status");
CREATE INDEX "AdPricePublication_chainId_contractAddress_status_createdAt_idx" ON "AdPricePublication"("chainId", "contractAddress", "status", "createdAt");
ALTER TABLE "AdIndexerState"
    ADD COLUMN "priceUpdaterAddress" TEXT,
    ADD COLUMN "preUsdPriceE18Raw" TEXT,
    ADD COLUMN "preUsdPriceQuotedAt" BIGINT;
ALTER TABLE "AdBillingClick"
    ADD COLUMN "priceBlockNumber" BIGINT,
    ADD COLUMN "priceBlockHash" TEXT;
