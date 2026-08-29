ALTER TABLE "ForumReply"
ADD COLUMN "parentReplyId" UUID;

ALTER TABLE "ForumReply"
ADD CONSTRAINT "ForumReply_parentReplyId_fkey"
FOREIGN KEY ("parentReplyId") REFERENCES "ForumReply"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ForumReply_parentReplyId_idx" ON "ForumReply"("parentReplyId");

CREATE TABLE "ForumNotification" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "replyId" UUID NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumNotification_recipientId_replyId_key"
ON "ForumNotification"("recipientId", "replyId");

CREATE INDEX "ForumNotification_recipientId_readAt_createdAt_idx"
ON "ForumNotification"("recipientId", "readAt", "createdAt");

CREATE INDEX "ForumNotification_topicId_createdAt_idx"
ON "ForumNotification"("topicId", "createdAt");

ALTER TABLE "ForumNotification"
ADD CONSTRAINT "ForumNotification_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumNotification"
ADD CONSTRAINT "ForumNotification_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumNotification"
ADD CONSTRAINT "ForumNotification_topicId_fkey"
FOREIGN KEY ("topicId") REFERENCES "ForumTopic"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumNotification"
ADD CONSTRAINT "ForumNotification_replyId_fkey"
FOREIGN KEY ("replyId") REFERENCES "ForumReply"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
