-- Rebuildable market projections must replay the new full-state PositionChanged event.
DELETE FROM "AdStakePosition";
DELETE FROM "AdChainEvent";
DELETE FROM "AdIndexerState";

ALTER TABLE "AdStakePosition"
  ADD COLUMN "bidUsdRaw" TEXT NOT NULL,
  ADD COLUMN "eligible" BOOLEAN NOT NULL,
  ADD COLUMN "withdrawAvailableAt" BIGINT NOT NULL,
  ADD COLUMN "positionVersion" BIGINT NOT NULL;
