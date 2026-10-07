-- PRE Keyword Market chain rows are a disposable projection. Clear them before changing
-- the projection identity from a normalized keyword string to its on-chain bytes32 id.
DELETE FROM "AdStakePosition";
DELETE FROM "AdChainEvent";
DELETE FROM "AdIndexerState";

DROP INDEX "AdStakePosition_chainId_contractAddress_canonicalKeyword_stakerAddress_key";
DROP INDEX "AdStakePosition_chainId_contractAddress_canonicalKeyword_active_idx";

ALTER TABLE "AdStakePosition"
DROP COLUMN "canonicalKeyword",
ADD COLUMN "keywordId" TEXT NOT NULL,
ADD CONSTRAINT "AdStakePosition_keyword_id_check" CHECK ("keywordId" ~ '^0x[0-9a-f]{64}$');

CREATE UNIQUE INDEX "AdStakePosition_chainId_contractAddress_keywordId_stakerAddress_key"
ON "AdStakePosition"("chainId", "contractAddress", "keywordId", "stakerAddress");

CREATE INDEX "AdStakePosition_chainId_contractAddress_keywordId_active_idx"
ON "AdStakePosition"("chainId", "contractAddress", "keywordId", "active");
