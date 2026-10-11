-- PRESENTER-HOME-B — PresenterNote, and the organizer on/off for sending them.
-- NOT APPLIED by the agent — CI and Render's build run migrate deploy.
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.
--
-- MUST-CONFIRMS:
-- 1) Additive. New table "PresenterNote" (id, sessionId, speakerId, body
--    varchar(600), createdAt) and one NEW column on "Event":
--    presenterNotesEnabled BOOLEAN NOT NULL DEFAULT true.
--    The column is in this migration because the checkbox has to persist and
--    this is the only migration this change is allowed to ship. Default true
--    matches "on unless the organizer turns it off". Existing rows are not
--    rewritten (PostgreSQL 11+ stores the default in the catalog).
-- 2) NO new enum and NO ADD VALUE. Notifications reuse an existing
--    NotificationKind so this file does not lock an enum.
-- 3) Both foreign keys are ON DELETE CASCADE so the demo reset's existing
--    session delete removes notes without a new wipe step. Rollback is a
--    forward fix: the table and column stay, unread, if an older API deploys.
-- 4) Idempotent: IF NOT EXISTS on the table, index, column, and constraints.

CREATE TABLE IF NOT EXISTS "PresenterNote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "speakerId" TEXT NOT NULL,
    "body" VARCHAR(600) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresenterNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PresenterNote_sessionId_createdAt_idx" ON "PresenterNote"("sessionId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PresenterNote"
    ADD CONSTRAINT "PresenterNote_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PresenterNote"
    ADD CONSTRAINT "PresenterNote_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "presenterNotesEnabled" BOOLEAN NOT NULL DEFAULT true;
