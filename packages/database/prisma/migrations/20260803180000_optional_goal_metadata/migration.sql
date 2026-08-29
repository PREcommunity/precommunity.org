-- Every administrative draft keeps a concrete parent, while General acts as the
-- default for goals that do not need a public subproject.
INSERT INTO "Subproject" (
  "id", "projectId", "slug", "name", "description", "archivedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  "Project"."id",
  'general',
  'General',
  'Default group for goals without a dedicated subproject.',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project"
ON CONFLICT ("projectId", "slug") DO UPDATE
SET
  "name" = 'General',
  "archivedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Expense"
  ALTER COLUMN "category" DROP NOT NULL,
  ALTER COLUMN "discussionUrl" DROP NOT NULL;
