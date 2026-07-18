-- Phase A5 — Organizer Ops Agent (event-time detectors + review-and-send cards)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. NotificationKind, AiMeterFeature,
--    AuditAction, SessionPublishStatus, ModerationReportStatus, etc. are UNTOUCHED.
--    OpsDetectorKind, OpsCardStatus, OpsDraftActionType are NEW CREATE TYPEs used
--    ONLY on OpsInboxCard (created in this migration) — fine in one transaction.
-- 2) Room.capacity: single ADD COLUMN IF NOT EXISTS … INTEGER NULL.
--    No backfill — existing rooms stay NULL (unknown; not ranked as "larger").
-- 3) Event.communityBlocklist: single ADD COLUMN IF NOT EXISTS …
--      JSONB NOT NULL DEFAULT '[]'::jsonb
--    Postgres fills every existing row with the constant DEFAULT. No separate UPDATE.
-- 4) Additive only — no ALTER of existing NOT NULL columns, no destructive drops.
-- 5) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use on OpsInboxCard in this migration — not ADD VALUE)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "OpsDetectorKind" AS ENUM (
    'SESSION_CHANGED',
    'QA_STALE',
    'LOW_CHECKIN',
    'CAPACITY_PRESSURE',
    'MODERATION',
    'DAILY_DIGEST'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OpsCardStatus" AS ENUM (
    'OPEN',
    'APPLIED',
    'DISMISSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OpsDraftActionType" AS ENUM (
    'ANNOUNCEMENT',
    'DM',
    'SPEAKER_NUDGE',
    'ROOM_MOVE',
    'OPEN_VIRTUAL',
    'MODERATION_REVIEW',
    'DIGEST_NOTE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Room.capacity — nullable ADD only (NULL = unknown)
-- ---------------------------------------------------------------------------
ALTER TABLE "Room"
  ADD COLUMN IF NOT EXISTS "capacity" INTEGER;

-- ---------------------------------------------------------------------------
-- 3) Event.communityBlocklist — constant DEFAULT fills existing rows
-- ---------------------------------------------------------------------------
ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "communityBlocklist" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 4) SessionScheduleChange — feed for SESSION_CHANGED detector
--    Written by app on PUBLISHED session startsAt/roomId change; detector consumes.
--    previousRoomId / newRoomId are TEXT snapshots (no FK — room may be deleted).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SessionScheduleChange" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "previousStartsAt" TIMESTAMP(3) NOT NULL,
  "newStartsAt" TIMESTAMP(3) NOT NULL,
  "previousRoomId" TEXT,
  "newRoomId" TEXT,
  "publishStatusAtChange" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "opsCardId" TEXT,
  CONSTRAINT "SessionScheduleChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionScheduleChange_eventId_consumedAt_idx"
  ON "SessionScheduleChange"("eventId", "consumedAt");
CREATE INDEX IF NOT EXISTS "SessionScheduleChange_sessionId_createdAt_idx"
  ON "SessionScheduleChange"("sessionId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SessionScheduleChange"
    ADD CONSTRAINT "SessionScheduleChange_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionScheduleChange"
    ADD CONSTRAINT "SessionScheduleChange_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) OpsInboxCard — review-and-send cards (nothing executes without a click)
--    UNIQUE (eventId, triggerInstanceKey) = sticky dismiss + idempotent create.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OpsInboxCard" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "detectorKind" "OpsDetectorKind" NOT NULL,
  "triggerInstanceKey" TEXT NOT NULL,
  "status" "OpsCardStatus" NOT NULL DEFAULT 'OPEN',
  "triggerSummary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "evidenceSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "draftActionType" "OpsDraftActionType" NOT NULL,
  "draftTitle" TEXT NOT NULL,
  "draftBody" TEXT NOT NULL,
  "draftPayload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "draftMetered" BOOLEAN NOT NULL DEFAULT false,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "appliedAt" TIMESTAMP(3),
  "appliedById" TEXT,
  "appliedChannelRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsInboxCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OpsInboxCard_eventId_triggerInstanceKey_key"
  ON "OpsInboxCard"("eventId", "triggerInstanceKey");
CREATE INDEX IF NOT EXISTS "OpsInboxCard_eventId_status_createdAt_idx"
  ON "OpsInboxCard"("eventId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "OpsInboxCard_eventId_detectorKind_createdAt_idx"
  ON "OpsInboxCard"("eventId", "detectorKind", "createdAt");
CREATE INDEX IF NOT EXISTS "OpsInboxCard_organizationId_createdAt_idx"
  ON "OpsInboxCard"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "OpsInboxCard_dismissedById_idx"
  ON "OpsInboxCard"("dismissedById");
CREATE INDEX IF NOT EXISTS "OpsInboxCard_appliedById_idx"
  ON "OpsInboxCard"("appliedById");

DO $$ BEGIN
  ALTER TABLE "OpsInboxCard"
    ADD CONSTRAINT "OpsInboxCard_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OpsInboxCard"
    ADD CONSTRAINT "OpsInboxCard_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OpsInboxCard"
    ADD CONSTRAINT "OpsInboxCard_dismissedById_fkey"
    FOREIGN KEY ("dismissedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OpsInboxCard"
    ADD CONSTRAINT "OpsInboxCard_appliedById_fkey"
    FOREIGN KEY ("appliedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
