CREATE TYPE "ForumCategory" AS ENUM ('GENERAL', 'IDEAS_FEEDBACK', 'TECHNICAL', 'HELP');
CREATE TYPE "ForumTopicStatus" AS ENUM ('PENDING_REVIEW', 'PUBLISHED', 'LOCKED', 'DECLINED', 'REMOVED');

CREATE TABLE "CommunitySettings" (
    "projectId" UUID NOT NULL,
    "forumTopicModerationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunitySettings_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "ForumTopic" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "ForumCategory" NOT NULL,
    "status" "ForumTopicStatus" NOT NULL DEFAULT 'PUBLISHED',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ForumTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ForumReply" (
    "id" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ForumReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumTopic_slug_key" ON "ForumTopic"("slug");
CREATE INDEX "ForumTopic_status_lastActivityAt_idx" ON "ForumTopic"("status", "lastActivityAt");
CREATE INDEX "ForumTopic_category_status_lastActivityAt_idx" ON "ForumTopic"("category", "status", "lastActivityAt");
CREATE INDEX "ForumTopic_authorId_createdAt_idx" ON "ForumTopic"("authorId", "createdAt");
CREATE INDEX "ForumReply_topicId_createdAt_idx" ON "ForumReply"("topicId", "createdAt");
CREATE INDEX "ForumReply_authorId_createdAt_idx" ON "ForumReply"("authorId", "createdAt");

ALTER TABLE "CommunitySettings" ADD CONSTRAINT "CommunitySettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ForumTopic" ADD CONSTRAINT "ForumTopic_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ForumTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
