-- Phase A1 — Agenda Ingest Agent
-- NOT APPLIED by the agent — review the FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) SessionPublishStatus is a NEW CREATE TYPE (not ADD VALUE on an existing enum).
--    Using it in the same migration for column add + backfill cast
--    ('PUBLISHED'::"SessionPublishStatus") is allowed.
-- 2) Session.publishStatus: ADD COLUMN nullable → UPDATE backfill existing rows to
--    PUBLISHED with explicit cast → SET NOT NULL + DEFAULT 'PUBLISHED'.
--    All existing sessions become PUBLISHED so the live DocWeek agenda stays visible.
-- 3) No NotificationKind (or other) ADD VALUE in this file.
--
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use in the same migration)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SessionPublishStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgendaIngestSourceKind" AS ENUM (
    'PASTE',
    'PDF',
    'DOCX',
    'XLSX',
    'CSV',
    'IMAGE',
    'URL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgendaIngestRunStatus" AS ENUM (
    'PENDING',
    'EXTRACTING',
    'READY_FOR_REVIEW',
    'CONFIRMING',
    'CONFIRMED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Session.publishStatus — nullable → backfill PUBLISHED → NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "publishStatus" "SessionPublishStatus";

UPDATE "Session"
SET "publishStatus" = 'PUBLISHED'::"SessionPublishStatus"
WHERE "publishStatus" IS NULL;

ALTER TABLE "Session"
  ALTER COLUMN "publishStatus" SET DEFAULT 'PUBLISHED'::"SessionPublishStatus";

ALTER TABLE "Session"
  ALTER COLUMN "publishStatus" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Session_eventId_publishStatus_idx"
  ON "Session"("eventId", "publishStatus");

-- ---------------------------------------------------------------------------
-- 3) AgendaIngestRun (history + raw source link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AgendaIngestRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdById" TEXT,
  "sourceKind" "AgendaIngestSourceKind" NOT NULL,
  "sourceFileName" TEXT,
  "sourceMime" TEXT,
  "sourceBytes" INTEGER,
  "sourceUrl" TEXT,
  "sourceStorageKey" TEXT,
  "sourceTextPreview" TEXT,
  "status" "AgendaIngestRunStatus" NOT NULL DEFAULT 'PENDING',
  "jobId" TEXT,
  "extraction" JSONB,
  "assumptions" JSONB NOT NULL DEFAULT '[]',
  "changeset" JSONB,
  "reviewState" JSONB,
  "error" TEXT,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "deletedCount" INTEGER NOT NULL DEFAULT 0,
  "speakerCount" INTEGER NOT NULL DEFAULT 0,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgendaIngestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgendaIngestRun_eventId_createdAt_idx"
  ON "AgendaIngestRun"("eventId", "createdAt");

CREATE INDEX IF NOT EXISTS "AgendaIngestRun_organizationId_createdAt_idx"
  ON "AgendaIngestRun"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "AgendaIngestRun_status_createdAt_idx"
  ON "AgendaIngestRun"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "AgendaIngestRun_createdById_createdAt_idx"
  ON "AgendaIngestRun"("createdById", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AgendaIngestRun"
    ADD CONSTRAINT "AgendaIngestRun_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaIngestRun"
    ADD CONSTRAINT "AgendaIngestRun_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AgendaIngestRun"
    ADD CONSTRAINT "AgendaIngestRun_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
