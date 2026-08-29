-- SPX-0 — sponsor outreach pipeline (DESIGN_PHASE_K D1).
-- NOT APPLIED by the agent — CI and Render's build run migrate deploy.
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. One NEW enum (SponsorProspectStatus) used only by a
--    table created here. Two NEW tables (SponsorProspect, OutreachTemplate).
--    ZERO ALTER TABLE on existing tables — existing readers cannot break.
--    OutreachTemplate is unused in SPX-0; it ships now so one migration
--    covers SPX-1's composer.
-- 2) NO ADD VALUE on any existing enum. NO drop, rename, retype, or NOT NULL
--    on existing columns. No backfill — both tables start empty.
-- 3) Applying this migration changes no UI until the sponsor_outreach feature
--    is on. Older code ignores unread tables.
-- 4) Rollback = turn sponsor_outreach off (rows become unreachable).
--    Forward-fix only (RUNBOOK §4).
-- 5) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

-- ---------------------------------------------------------------------------
-- 1) New enum (used only by SponsorProspect, created below)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SponsorProspectStatus" AS ENUM (
    'TO_CONTACT',
    'CONTACTED',
    'IN_CONVERSATION',
    'CONFIRMED',
    'DECLINED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) SponsorProspect — private pipeline. UKEDL never emails these rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SponsorProspect" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "orgName" TEXT NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "websiteUrl" TEXT,
  "notes" TEXT,
  "status" "SponsorProspectStatus" NOT NULL DEFAULT 'TO_CONTACT',
  "lastContactedAt" TIMESTAMP(3),
  "sponsorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SponsorProspect_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SponsorProspect_eventId_status_idx"
  ON "SponsorProspect"("eventId", "status");
CREATE INDEX IF NOT EXISTS "SponsorProspect_eventId_orgName_idx"
  ON "SponsorProspect"("eventId", "orgName");

DO $$ BEGIN
  ALTER TABLE "SponsorProspect"
    ADD CONSTRAINT "SponsorProspect_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SponsorProspect"
    ADD CONSTRAINT "SponsorProspect_sponsorId_fkey"
    FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) OutreachTemplate — SPX-1 composer. Created now; unused in this slice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OutreachTemplate" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutreachTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutreachTemplate_eventId_idx"
  ON "OutreachTemplate"("eventId");

DO $$ BEGIN
  ALTER TABLE "OutreachTemplate"
    ADD CONSTRAINT "OutreachTemplate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
