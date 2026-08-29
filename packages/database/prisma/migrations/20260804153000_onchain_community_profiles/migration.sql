-- Community profiles and per-contribution visibility are now canonical escrow events.

ALTER TABLE "SponsorProfile" RENAME COLUMN "avatarUrl" TO "avatarUri";

ALTER TABLE "SponsorProfile"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "avatarStatus" "MetadataStatus" NOT NULL DEFAULT 'NOT_SET',
ADD COLUMN "defaultPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "chainId" INTEGER,
ADD COLUMN "blockNumber" BIGINT,
ADD COLUMN "blockHash" TEXT,
ADD COLUMN "txHash" TEXT,
ADD COLUMN "logIndex" INTEGER;

UPDATE "SponsorProfile"
SET "defaultPublic" = ("defaultVisibility" = 'PUBLIC');

ALTER TABLE "SponsorProfile"
DROP COLUMN "socialLinks",
DROP COLUMN "defaultVisibility";

CREATE INDEX "SponsorProfile_chainId_blockNumber_idx" ON "SponsorProfile"("chainId", "blockNumber");
CREATE INDEX "SponsorProfile_active_hidden_idx" ON "SponsorProfile"("active", "hidden");

-- Existing testnet contribution rows may predate wallet disclosure. Bind every row
-- to a normalized address before making the projection relation mandatory.
INSERT INTO "User" ("id", "address", "roles", "createdAt", "updatedAt")
SELECT
  (
    SUBSTRING(MD5('precommunity-contributor:' || LOWER("contributor")), 1, 8) || '-' ||
    SUBSTRING(MD5('precommunity-contributor:' || LOWER("contributor")), 9, 4) || '-' ||
    SUBSTRING(MD5('precommunity-contributor:' || LOWER("contributor")), 13, 4) || '-' ||
    SUBSTRING(MD5('precommunity-contributor:' || LOWER("contributor")), 17, 4) || '-' ||
    SUBSTRING(MD5('precommunity-contributor:' || LOWER("contributor")), 21, 12)
  )::UUID,
  LOWER("contributor"),
  ARRAY[]::"Role"[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CryptoContribution"
WHERE "userId" IS NULL
GROUP BY LOWER("contributor")
ON CONFLICT ("address") DO NOTHING;

UPDATE "CryptoContribution" AS contribution
SET "userId" = "User"."id"
FROM "User"
WHERE contribution."userId" IS NULL
  AND LOWER(contribution."contributor") = LOWER("User"."address");

ALTER TABLE "CryptoContribution" DROP CONSTRAINT "CryptoContribution_userId_fkey";
ALTER TABLE "CryptoContribution" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CryptoContribution"
ADD CONSTRAINT "CryptoContribution_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "ContributionDisclosure";
