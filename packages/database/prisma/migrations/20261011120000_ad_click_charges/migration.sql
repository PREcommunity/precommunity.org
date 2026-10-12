-- CreateTable
CREATE TABLE "AdBillingClick" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "stakerAddress" TEXT NOT NULL,
    "positionVersion" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CAPTURING',
    "bidUsdRaw" TEXT,
    "amountPreRaw" TEXT,
    "priceQuoteId" UUID,
    "priceUsd" TEXT,
    "priceQuotedAt" TIMESTAMP(3),
    "captureSource" TEXT,
    "bidBlockNumber" BIGINT,
    "bidBlockHash" TEXT,
    "errorCode" TEXT,
    "batchId" UUID,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdBillingClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChargeSettings" (
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "automaticEnabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "clickThreshold" INTEGER NOT NULL DEFAULT 50,
    "updatedBy" TEXT,
    "workerHeartbeatAt" TIMESTAMP(3),
    "reconciliationBlockNumber" BIGINT,
    "reconciliationBlockHash" TEXT,
    "signerAddress" TEXT,
    "operatorAddress" TEXT,
    "gasBalanceRaw" TEXT,
    "readiness" TEXT NOT NULL DEFAULT 'WORKER_UNAVAILABLE',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdChargeSettings_pkey" PRIMARY KEY ("chainId","contractAddress")
);

-- CreateTable
CREATE TABLE "AdChargeRun" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "actorAddress" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdChargeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChargeBatch" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "chargeId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "stakerAddress" TEXT NOT NULL,
    "positionVersion" BIGINT NOT NULL,
    "clickCount" INTEGER NOT NULL,
    "duePreRaw" TEXT NOT NULL,
    "requestedPreRaw" TEXT NOT NULL,
    "chargedPreRaw" TEXT,
    "shortfallPreRaw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "txHash" TEXT,
    "settledTxHash" TEXT,
    "signedTransaction" TEXT,
    "signerAddress" TEXT,
    "nonce" BIGINT,
    "receiptBlockNumber" BIGINT,
    "receiptBlockHash" TEXT,
    "errorCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdChargeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdBillingClick_chainId_contractAddress_status_clickedAt_idx" ON "AdBillingClick"("chainId", "contractAddress", "status", "clickedAt");

-- CreateIndex
CREATE INDEX "AdBillingClick_batchId_idx" ON "AdBillingClick"("batchId");

-- CreateIndex
CREATE INDEX "AdChargeRun_chainId_contractAddress_status_createdAt_idx" ON "AdChargeRun"("chainId", "contractAddress", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AdChargeRun_chainId_contractAddress_createdAt_idx" ON "AdChargeRun"("chainId", "contractAddress", "createdAt");

-- CreateIndex
CREATE INDEX "AdChargeBatch_chainId_signerAddress_status_idx" ON "AdChargeBatch"("chainId", "signerAddress", "status");

-- CreateIndex
CREATE INDEX "AdChargeBatch_chainId_contractAddress_status_createdAt_idx" ON "AdChargeBatch"("chainId", "contractAddress", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AdChargeBatch_chainId_contractAddress_createdAt_id_idx" ON "AdChargeBatch"("chainId", "contractAddress", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AdChargeBatch_runId_idx" ON "AdChargeBatch"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AdChargeBatch_chainId_contractAddress_chargeId_key" ON "AdChargeBatch"("chainId", "contractAddress", "chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdChargeBatch_chainId_signerAddress_nonce_key" ON "AdChargeBatch"("chainId", "signerAddress", "nonce");

-- AddForeignKey
ALTER TABLE "AdBillingClick" ADD CONSTRAINT "AdBillingClick_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AdChargeBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChargeBatch" ADD CONSTRAINT "AdChargeBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AdChargeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdChargeSettings" ADD CONSTRAINT "AdChargeSettings_positive_thresholds"
    CHECK ("intervalMinutes" > 0 AND "clickThreshold" > 0);
