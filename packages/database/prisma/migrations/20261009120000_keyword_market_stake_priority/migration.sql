BEGIN;

ALTER TABLE "AdStakePosition"
ADD COLUMN "stakeSinceBlock" BIGINT,
ADD COLUMN "stakeSinceLogIndex" INTEGER;

-- The first event of the current position version opened that stake, before any top-ups or charges.
WITH openings AS (
    SELECT DISTINCT ON (position."id")
        position."id", event."blockNumber", event."logIndex"
    FROM "AdStakePosition" AS position
    JOIN "AdChainEvent" AS event
      ON event."chainId" = position."chainId"
     AND event."contractAddress" = position."contractAddress"
     AND event."eventName" = 'PositionChanged'
     AND event."payload" ->> 'keywordId' = position."keywordId"
     AND event."payload" ->> 'stakerAddress' = position."stakerAddress"
     AND event."payload" ->> 'positionVersion' = position."positionVersion"::text
     AND event."payload" ->> 'previousStakeRaw' = '0'
     AND event."payload" ->> 'stakeRaw' ~ '^[1-9][0-9]*$'
    ORDER BY position."id", event."blockNumber", event."logIndex"
)
UPDATE "AdStakePosition" AS position
SET "stakeSinceBlock" = openings."blockNumber",
    "stakeSinceLogIndex" = openings."logIndex"
FROM openings
WHERE position."id" = openings."id";

-- Missing event history must be rebuilt rather than assigning guessed tie priority.
ALTER TABLE "AdStakePosition"
ALTER COLUMN "stakeSinceBlock" SET NOT NULL,
ALTER COLUMN "stakeSinceLogIndex" SET NOT NULL;

COMMIT;
