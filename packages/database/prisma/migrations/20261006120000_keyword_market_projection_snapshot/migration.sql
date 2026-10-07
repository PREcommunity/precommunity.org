-- Chain projections are disposable. Replay from deployment to populate complete
-- position state and avoid treating an old ABI checkpoint as synchronized.
BEGIN;

LOCK TABLE "AdChainEvent", "AdStakePosition", "AdIndexerState" IN ACCESS EXCLUSIVE MODE;

DELETE FROM "AdStakePosition";
DELETE FROM "AdChainEvent";
DELETE FROM "AdIndexerState";

ALTER TABLE "AdStakePosition"
ADD COLUMN "requiredCoveragePreRaw" TEXT NOT NULL,
ADD CONSTRAINT "AdStakePosition_coverage_raw_check"
CHECK ("requiredCoveragePreRaw" ~ '^(0|[1-9][0-9]*)$');

ALTER TABLE "AdIndexerState"
ADD COLUMN "minimumStakeRaw" TEXT,
ADD COLUMN "paused" BOOLEAN,
ADD COLUMN "operatorAddress" TEXT,
ADD COLUMN "configBlockNumber" BIGINT;

COMMIT;
