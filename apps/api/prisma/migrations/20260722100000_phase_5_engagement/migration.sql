-- Phase 5 — Engagement & organizer analytics
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum (NotificationKind, EventMemberRole, etc.).
-- 2) CheckInMethod + SessionPollStatus are NEW CREATE TYPEs only.
-- 3) CheckIn.method: NULLABLE → backfill with explicit "SELF"::"CheckInMethod" → NOT NULL.
-- 4) EventMembership.checkInCode: NULLABLE → backfill gen_random_uuid → NOT NULL + unique.
-- 5) Q&A moderation/answered columns are nullable ADD only (no NOT NULL rewrite).
-- 6) New tables additive. No other ALTER of existing NOT NULL columns.
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use in this migration — not ADD VALUE)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "CheckInMethod" AS ENUM ('SELF', 'STAFF_SCAN', 'QR_SCAN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SessionPollStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) EventMembership.checkInCode — QR / offline scanner lookup
-- ---------------------------------------------------------------------------
ALTER TABLE "EventMembership"
  ADD COLUMN IF NOT EXISTS "checkInCode" TEXT;

UPDATE "EventMembership"
SET "checkInCode" = replace(gen_random_uuid()::text, '-', '')
WHERE "checkInCode" IS NULL;

ALTER TABLE "EventMembership"
  ALTER COLUMN "checkInCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "EventMembership_eventId_checkInCode_key"
  ON "EventMembership"("eventId", "checkInCode");

CREATE INDEX IF NOT EXISTS "EventMembership_checkInCode_idx"
  ON "EventMembership"("checkInCode");

-- ---------------------------------------------------------------------------
-- 3) CheckIn — method + staff scanner + offline clientMutationId
-- ---------------------------------------------------------------------------
ALTER TABLE "CheckIn"
  ADD COLUMN IF NOT EXISTS "method" "CheckInMethod";

UPDATE "CheckIn"
SET "method" = 'SELF'::"CheckInMethod"
WHERE "method" IS NULL;

ALTER TABLE "CheckIn"
  ALTER COLUMN "method" SET DEFAULT 'SELF'::"CheckInMethod";

ALTER TABLE "CheckIn"
  ALTER COLUMN "method" SET NOT NULL;

ALTER TABLE "CheckIn"
  ADD COLUMN IF NOT EXISTS "scannedByUserId" TEXT;

ALTER TABLE "CheckIn"
  ADD COLUMN IF NOT EXISTS "clientMutationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CheckIn_clientMutationId_key"
  ON "CheckIn"("clientMutationId")
  WHERE "clientMutationId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "CheckIn_eventId_createdAt_idx"
  ON "CheckIn"("eventId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CheckIn"
    ADD CONSTRAINT "CheckIn_scannedByUserId_fkey"
    FOREIGN KEY ("scannedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Session Q&A upgrade — answered / hide (nullable) + upvotes table
-- ---------------------------------------------------------------------------
ALTER TABLE "SessionDiscussionThread"
  ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP(3);

ALTER TABLE "SessionDiscussionThread"
  ADD COLUMN IF NOT EXISTS "answeredById" TEXT;

ALTER TABLE "SessionDiscussionThread"
  ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);

ALTER TABLE "SessionDiscussionThread"
  ADD COLUMN IF NOT EXISTS "hiddenById" TEXT;

DO $$ BEGIN
  ALTER TABLE "SessionDiscussionThread"
    ADD CONSTRAINT "SessionDiscussionThread_answeredById_fkey"
    FOREIGN KEY ("answeredById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionDiscussionThread"
    ADD CONSTRAINT "SessionDiscussionThread_hiddenById_fkey"
    FOREIGN KEY ("hiddenById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "SessionDiscussionThread_sessionId_createdAt_idx"
  ON "SessionDiscussionThread"("sessionId", "createdAt");

CREATE TABLE IF NOT EXISTS "SessionDiscussionUpvote" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionDiscussionUpvote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionDiscussionUpvote_threadId_userId_key"
  ON "SessionDiscussionUpvote"("threadId", "userId");
CREATE INDEX IF NOT EXISTS "SessionDiscussionUpvote_userId_idx"
  ON "SessionDiscussionUpvote"("userId");

DO $$ BEGIN
  ALTER TABLE "SessionDiscussionUpvote"
    ADD CONSTRAINT "SessionDiscussionUpvote_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "SessionDiscussionThread"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionDiscussionUpvote"
    ADD CONSTRAINT "SessionDiscussionUpvote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Live polls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SessionPoll" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" "SessionPollStatus" NOT NULL DEFAULT 'DRAFT',
  "showResultsToAttendees" BOOLEAN NOT NULL DEFAULT true,
  "openedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPoll_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionPoll_sessionId_status_idx"
  ON "SessionPoll"("sessionId", "status");

DO $$ BEGIN
  ALTER TABLE "SessionPoll"
    ADD CONSTRAINT "SessionPoll_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionPoll"
    ADD CONSTRAINT "SessionPoll_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SessionPollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SessionPollOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionPollOption_pollId_sortOrder_idx"
  ON "SessionPollOption"("pollId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "SessionPollOption"
    ADD CONSTRAINT "SessionPollOption_pollId_fkey"
    FOREIGN KEY ("pollId") REFERENCES "SessionPoll"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SessionPollVote" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPollVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionPollVote_pollId_userId_key"
  ON "SessionPollVote"("pollId", "userId");
CREATE INDEX IF NOT EXISTS "SessionPollVote_optionId_idx"
  ON "SessionPollVote"("optionId");

DO $$ BEGIN
  ALTER TABLE "SessionPollVote"
    ADD CONSTRAINT "SessionPollVote_pollId_fkey"
    FOREIGN KEY ("pollId") REFERENCES "SessionPoll"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionPollVote"
    ADD CONSTRAINT "SessionPollVote_optionId_fkey"
    FOREIGN KEY ("optionId") REFERENCES "SessionPollOption"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionPollVote"
    ADD CONSTRAINT "SessionPollVote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Session feedback (1–5 + comment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SessionFeedback" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionFeedback_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionFeedback_sessionId_userId_key"
  ON "SessionFeedback"("sessionId", "userId");
CREATE INDEX IF NOT EXISTS "SessionFeedback_sessionId_idx"
  ON "SessionFeedback"("sessionId");

DO $$ BEGIN
  ALTER TABLE "SessionFeedback"
    ADD CONSTRAINT "SessionFeedback_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionFeedback"
    ADD CONSTRAINT "SessionFeedback_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Sponsors + lead capture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Sponsor" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logoUrl" TEXT,
  "url" TEXT,
  "tier" TEXT NOT NULL DEFAULT 'Standard',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "boothLabel" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Sponsor_eventId_sortOrder_idx"
  ON "Sponsor"("eventId", "sortOrder");
CREATE INDEX IF NOT EXISTS "Sponsor_eventId_tier_idx"
  ON "Sponsor"("eventId", "tier");

DO $$ BEGIN
  ALTER TABLE "Sponsor"
    ADD CONSTRAINT "Sponsor_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SponsorLead" (
  "id" TEXT NOT NULL,
  "sponsorId" TEXT NOT NULL,
  "capturedByUserId" TEXT,
  "attendeeUserId" TEXT,
  "name" TEXT,
  "email" TEXT,
  "company" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SponsorLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SponsorLead_sponsorId_createdAt_idx"
  ON "SponsorLead"("sponsorId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SponsorLead"
    ADD CONSTRAINT "SponsorLead_sponsorId_fkey"
    FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SponsorLead"
    ADD CONSTRAINT "SponsorLead_capturedByUserId_fkey"
    FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SponsorLead"
    ADD CONSTRAINT "SponsorLead_attendeeUserId_fkey"
    FOREIGN KEY ("attendeeUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
