CREATE TABLE "AdApiKey" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdByAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AdApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdApiKey_keyHash_key" ON "AdApiKey"("keyHash");

ALTER TABLE "AdCreativeRevision"
    ADD COLUMN "lifetimeViews" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "lifetimeClicks" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "AdDailyMetric"
    ADD COLUMN "views" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "clicks" BIGINT NOT NULL DEFAULT 0;
