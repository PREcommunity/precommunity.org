-- CreateEnum
CREATE TYPE "AdCreativeStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AdReportReason" AS ENUM ('SCAM_PHISHING', 'MISLEADING', 'INAPPROPRIATE', 'BROKEN_LINK', 'OTHER');

-- CreateEnum
CREATE TYPE "AdReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

-- Scope every new SIWE challenge to the host that issued it.
ALTER TABLE "WalletSession"
ADD COLUMN "siweDomain" TEXT,
ADD COLUMN "siweUri" TEXT;

CREATE TABLE "AdCampaign" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "canonicalKeyword" TEXT NOT NULL,
    "activeRevisionId" UUID,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdCampaign_keyword_length_check" CHECK (char_length("canonicalKeyword") BETWEEN 1 AND 64)
);

CREATE TABLE "AdCreativeRevision" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "displayDomain" TEXT NOT NULL,
    "status" "AdCreativeStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "moderatedByAddress" TEXT,
    "moderationNote" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "lifetimeResolutions" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCreativeRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdCreativeRevision_headline_length_check" CHECK (char_length("headline") <= 60),
    CONSTRAINT "AdCreativeRevision_description_length_check" CHECK (char_length("description") BETWEEN 1 AND 160),
    CONSTRAINT "AdCreativeRevision_destination_length_check" CHECK (char_length("destinationUrl") BETWEEN 1 AND 2048)
);

CREATE TABLE "AdStakePosition" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "canonicalKeyword" TEXT NOT NULL,
    "stakerAddress" TEXT NOT NULL,
    "stakeRaw" TEXT NOT NULL,
    "amountSinceBlock" BIGINT NOT NULL,
    "amountSinceLogIndex" INTEGER NOT NULL,
    "positionBlock" BIGINT NOT NULL,
    "positionBlockHash" TEXT NOT NULL,
    "positionTxHash" TEXT NOT NULL,
    "positionLogIndex" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdStakePosition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdStakePosition_stake_raw_check" CHECK ("stakeRaw" ~ '^(0|[1-9][0-9]*)$')
);

CREATE TABLE "AdChainEvent" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdChainEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdIndexerState" (
    "key" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL,
    "lastBlockHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdIndexerState_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AdReport" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "reason" "AdReportReason" NOT NULL,
    "comment" TEXT,
    "reporterFingerprint" TEXT NOT NULL,
    "fingerprintDay" DATE NOT NULL,
    "status" "AdReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByAddress" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdReport_comment_length_check" CHECK ("comment" IS NULL OR char_length("comment") <= 500)
);

CREATE TABLE "AdReportAggregate" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "reason" "AdReportReason" NOT NULL,
    "total" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdReportAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdDailyMetric" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "resolutions" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdMetricFlush" (
    "id" TEXT NOT NULL,
    "bucketDay" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdMetricFlush_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdCampaign_activeRevisionId_key" ON "AdCampaign"("activeRevisionId");
CREATE UNIQUE INDEX "AdCampaign_userId_canonicalKeyword_key" ON "AdCampaign"("userId", "canonicalKeyword");
CREATE INDEX "AdCampaign_canonicalKeyword_pausedAt_idx" ON "AdCampaign"("canonicalKeyword", "pausedAt");
CREATE INDEX "AdCampaign_userId_updatedAt_idx" ON "AdCampaign"("userId", "updatedAt");

CREATE UNIQUE INDEX "AdCreativeRevision_campaignId_version_key" ON "AdCreativeRevision"("campaignId", "version");
CREATE INDEX "AdCreativeRevision_status_createdAt_idx" ON "AdCreativeRevision"("status", "createdAt");
CREATE INDEX "AdCreativeRevision_campaignId_status_version_idx" ON "AdCreativeRevision"("campaignId", "status", "version");

CREATE UNIQUE INDEX "AdStakePosition_chainId_contractAddress_canonicalKeyword_stakerAddress_key"
ON "AdStakePosition"("chainId", "contractAddress", "canonicalKeyword", "stakerAddress");
CREATE INDEX "AdStakePosition_chainId_contractAddress_canonicalKeyword_active_idx"
ON "AdStakePosition"("chainId", "contractAddress", "canonicalKeyword", "active");
CREATE INDEX "AdStakePosition_stakerAddress_active_idx" ON "AdStakePosition"("stakerAddress", "active");

CREATE UNIQUE INDEX "AdChainEvent_chainId_contractAddress_txHash_logIndex_key"
ON "AdChainEvent"("chainId", "contractAddress", "txHash", "logIndex");
CREATE INDEX "AdChainEvent_chainId_contractAddress_blockNumber_idx"
ON "AdChainEvent"("chainId", "contractAddress", "blockNumber");
CREATE INDEX "AdIndexerState_chainId_contractAddress_idx" ON "AdIndexerState"("chainId", "contractAddress");

CREATE UNIQUE INDEX "AdReport_revisionId_reporterFingerprint_fingerprintDay_key"
ON "AdReport"("revisionId", "reporterFingerprint", "fingerprintDay");
CREATE INDEX "AdReport_status_createdAt_idx" ON "AdReport"("status", "createdAt");
CREATE INDEX "AdReport_revisionId_status_createdAt_idx" ON "AdReport"("revisionId", "status", "createdAt");
CREATE UNIQUE INDEX "AdReportAggregate_revisionId_reason_key" ON "AdReportAggregate"("revisionId", "reason");
CREATE UNIQUE INDEX "AdDailyMetric_revisionId_day_key" ON "AdDailyMetric"("revisionId", "day");
CREATE INDEX "AdDailyMetric_day_idx" ON "AdDailyMetric"("day");
CREATE INDEX "AdMetricFlush_createdAt_idx" ON "AdMetricFlush"("createdAt");

ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdCreativeRevision" ADD CONSTRAINT "AdCreativeRevision_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_activeRevisionId_fkey"
FOREIGN KEY ("activeRevisionId") REFERENCES "AdCreativeRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdReport" ADD CONSTRAINT "AdReport_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "AdCreativeRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdReportAggregate" ADD CONSTRAINT "AdReportAggregate_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "AdCreativeRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdDailyMetric" ADD CONSTRAINT "AdDailyMetric_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "AdCreativeRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
