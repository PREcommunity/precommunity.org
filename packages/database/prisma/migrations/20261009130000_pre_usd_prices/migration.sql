CREATE TABLE "PreUsdPrice" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "priceUsd" DECIMAL(38,18) NOT NULL,
    "quotedAt" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreUsdPrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PreUsdPrice_positive_price" CHECK ("priceUsd" > 0)
);

CREATE UNIQUE INDEX "PreUsdPrice_source_assetId_quotedAt_key"
    ON "PreUsdPrice"("source", "assetId", "quotedAt");
