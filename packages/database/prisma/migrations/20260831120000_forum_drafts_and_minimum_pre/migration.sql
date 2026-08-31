ALTER TYPE "ForumTopicStatus" ADD VALUE 'DRAFT' BEFORE 'PENDING_REVIEW';

ALTER TABLE "CommunitySettings"
ADD COLUMN "forumMinimumPreRaw" TEXT;
