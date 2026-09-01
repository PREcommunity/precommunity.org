ALTER TABLE "ForumTopic"
ALTER COLUMN "category" TYPE TEXT USING "category"::text;

DROP TYPE "ForumCategory";

CREATE TABLE "ForumCategory" (
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("value"),
    CONSTRAINT "ForumCategory_value_length_check" CHECK (char_length("value") BETWEEN 1 AND 64),
    CONSTRAINT "ForumCategory_label_length_check" CHECK (char_length("label") BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "ForumCategory_label_key" ON "ForumCategory"("label");

INSERT INTO "ForumCategory" ("value", "label", "position", "updatedAt") VALUES
    ('GENERAL', 'General', 0, CURRENT_TIMESTAMP),
    ('IDEAS_FEEDBACK', 'Ideas & Feedback', 1, CURRENT_TIMESTAMP),
    ('TECHNICAL', 'Technical', 2, CURRENT_TIMESTAMP),
    ('HELP', 'Help', 3, CURRENT_TIMESTAMP);

ALTER TABLE "ForumTopic"
ADD CONSTRAINT "ForumTopic_category_fkey"
FOREIGN KEY ("category") REFERENCES "ForumCategory"("value")
ON DELETE RESTRICT ON UPDATE CASCADE;
