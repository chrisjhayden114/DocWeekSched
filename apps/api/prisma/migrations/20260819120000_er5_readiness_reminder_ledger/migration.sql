-- ER5 — readiness reminder ledger (automatic 7-day / 2-day / overdue emails)
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. ReadinessReminderStage is a NEW
--    CREATE TYPE used only on the table created in this migration.
-- 2) Additive only: ONE new table (ReadinessReminderSend). ZERO ALTER TABLE on
--    existing tables — existing readers cannot break.
-- 3) The (assignmentId, stage) unique index IS the "each stage fires at most
--    once" rule. Both columns are NOT NULL, so Postgres NULL-distinctness
--    cannot weaken it (unlike ReadinessAssignment's subject key).
-- 4) Table starts empty; no backfill. An empty ledger means every currently
--    open assignment is eligible for its CURRENT stage only — a first sweep
--    sends one email per presenter, never one per missed stage.
-- 5) Rollback = disable the readiness feature key or stop the sweep (rows
--    become unreachable). Forward-fix only (RUNBOOK §4).
-- 6) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Do NOT run against production.

-- ---------------------------------------------------------------------------
-- 1) New enum (used only by ReadinessReminderSend, created below)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ReadinessReminderStage" AS ENUM (
    'UPCOMING_7D',
    'UPCOMING_2D',
    'OVERDUE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) ReadinessReminderSend — one row per (assignment, stage) ever emailed.
--    speakerId/eventId are carried for grouping and tenant-scoped reads; the
--    assignment FK owns the cascade that matters (delete an assignment and its
--    reminder history goes with it).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessReminderSend" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "speakerId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "stage" "ReadinessReminderStage" NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessReminderSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessReminderSend_assignmentId_stage_key"
  ON "ReadinessReminderSend"("assignmentId", "stage");
CREATE INDEX IF NOT EXISTS "ReadinessReminderSend_eventId_sentAt_idx"
  ON "ReadinessReminderSend"("eventId", "sentAt");
CREATE INDEX IF NOT EXISTS "ReadinessReminderSend_speakerId_idx"
  ON "ReadinessReminderSend"("speakerId");

DO $$ BEGIN
  ALTER TABLE "ReadinessReminderSend"
    ADD CONSTRAINT "ReadinessReminderSend_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessReminderSend"
    ADD CONSTRAINT "ReadinessReminderSend_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessReminderSend"
    ADD CONSTRAINT "ReadinessReminderSend_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "ReadinessAssignment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
