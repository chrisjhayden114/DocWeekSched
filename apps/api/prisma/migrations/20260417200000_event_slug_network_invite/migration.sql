-- CreateEnum
CREATE TYPE "NetworkChannel" AS ENUM ('GENERAL', 'MEETUP', 'MOMENTS', 'LOCAL', 'ICEBREAKER');

-- AlterTable Event: add slug (nullable first)
ALTER TABLE "Event" ADD COLUMN "slug" TEXT;

-- Backfill slug from name + id fragment
UPDATE "Event"
SET "slug" = CONCAT(
  CASE
    WHEN TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE("name", ''), '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'))) = ''
    THEN 'event'
    ELSE TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(REGEXP_REPLACE("name", '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g')))
  END,
  '-',
  SUBSTRING("id" FROM 1 FOR 8)
)
WHERE "slug" IS NULL;

CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

ALTER TABLE "Event" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "profileSetupToken" TEXT,
ADD COLUMN     "profileSetupTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_profileSetupToken_key" ON "User"("profileSetupToken");

-- AlterTable NetworkThread
ALTER TABLE "NetworkThread" ADD COLUMN     "channel" "NetworkChannel" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "meetupMode" "SessionJoinMode",
ADD COLUMN     "meetupStartsAt" TIMESTAMP(3),
ADD COLUMN     "imageUrl" TEXT;
