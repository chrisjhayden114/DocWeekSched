-- ER2 — Event Readiness data layer (audit doc §10.1, migration 1)
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. ReadinessAssignmentStatus is a NEW
--    CREATE TYPE used only on a table created in this migration.
--    LATE / BLOCKED are DERIVED states and intentionally NOT in the enum.
-- 2) Additive only: FIVE new tables (ReadinessTemplate, ReadinessRequirement,
--    ReadinessAssignment, ReadinessSubmission, ReadinessPortalAccess).
--    ZERO ALTER TABLE on existing tables — existing readers cannot break.
-- 3) EventMembership (including checkInCode and its default) is UNTOUCHED.
-- 4) All tables start empty; no backfill. Rollback = disable the readiness
--    feature key (rows become unreachable). Forward-fix only (RUNBOOK §4).
-- 5) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Do NOT run against production.

-- ---------------------------------------------------------------------------
-- 1) New enum (used only by ReadinessAssignment, created below)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ReadinessAssignmentStatus" AS ENUM (
    'NOT_STARTED',
    'IN_PROGRESS',
    'SUBMITTED',
    'NEEDS_REVIEW',
    'READY',
    'WAIVED',
    'NOT_APPLICABLE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) ReadinessTemplate — per-event requirement set ("Keynote speaker", …)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessTemplate_eventId_name_key"
  ON "ReadinessTemplate"("eventId", "name");
CREATE INDEX IF NOT EXISTS "ReadinessTemplate_organizationId_idx"
  ON "ReadinessTemplate"("organizationId");

DO $$ BEGIN
  ALTER TABLE "ReadinessTemplate"
    ADD CONSTRAINT "ReadinessTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessTemplate"
    ADD CONSTRAINT "ReadinessTemplate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) ReadinessRequirement — child rows of a template (SurveyQuestion pattern).
--    eventId is denormalized for tenant-scoped queries (OpsInboxCard pattern);
--    intentionally NO FK on it — the template FK owns the cascade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessRequirement" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "helpText" TEXT,
  "kind" TEXT NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "dueAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessRequirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReadinessRequirement_templateId_sortOrder_idx"
  ON "ReadinessRequirement"("templateId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ReadinessRequirement_eventId_idx"
  ON "ReadinessRequirement"("eventId");

DO $$ BEGIN
  ALTER TABLE "ReadinessRequirement"
    ADD CONSTRAINT "ReadinessRequirement_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ReadinessTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) ReadinessAssignment — (requirement × subject) join + stored status.
--    Subject: exactly one of speakerId | sessionId; sessionItemId optional
--    refinement. LATE is derived from dueAtOverride ?? requirement.dueAt at
--    read time — never stored. waivedById / ownerUserId are plain User-id
--    columns (SetNull semantics via app layer + AuditLog), no FK by design.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "speakerId" TEXT,
  "sessionId" TEXT,
  "sessionItemId" TEXT,
  "status" "ReadinessAssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "dueAtOverride" TIMESTAMP(3),
  "waivedAt" TIMESTAMP(3),
  "waivedById" TEXT,
  "ownerUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessAssignment_pkey" PRIMARY KEY ("id")
);

-- NOTE: Postgres treats NULLs as distinct in unique indexes, so this key alone
-- does not fully dedupe (speaker-only or session-only rows have NULL columns).
-- Assignment creation also dedupes in the app layer inside a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS
  "ReadinessAssignment_requirementId_speakerId_sessionId_sessi_key"
  ON "ReadinessAssignment"("requirementId", "speakerId", "sessionId", "sessionItemId");
CREATE INDEX IF NOT EXISTS "ReadinessAssignment_eventId_status_idx"
  ON "ReadinessAssignment"("eventId", "status");
CREATE INDEX IF NOT EXISTS "ReadinessAssignment_eventId_dueAtOverride_idx"
  ON "ReadinessAssignment"("eventId", "dueAtOverride");
CREATE INDEX IF NOT EXISTS "ReadinessAssignment_speakerId_idx"
  ON "ReadinessAssignment"("speakerId");
CREATE INDEX IF NOT EXISTS "ReadinessAssignment_sessionId_idx"
  ON "ReadinessAssignment"("sessionId");

DO $$ BEGIN
  ALTER TABLE "ReadinessAssignment"
    ADD CONSTRAINT "ReadinessAssignment_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessAssignment"
    ADD CONSTRAINT "ReadinessAssignment_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "ReadinessRequirement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessAssignment"
    ADD CONSTRAINT "ReadinessAssignment_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessAssignment"
    ADD CONSTRAINT "ReadinessAssignment_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessAssignment"
    ADD CONSTRAINT "ReadinessAssignment_sessionItemId_fkey"
    FOREIGN KEY ("sessionItemId") REFERENCES "SessionItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) ReadinessSubmission — supersede-not-destroy value chain per assignment
--    (EventRecapSection SUPERSEDED + OpsInboxCard approve/reject pattern).
--    eventId denormalized, no FK (assignment FK owns the cascade).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessSubmission" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "valueText" TEXT,
  "valueJson" JSONB,
  "fileName" TEXT,
  "fileMime" TEXT,
  "fileSizeBytes" INTEGER,
  "fileUrl" TEXT,
  "fileStorageKey" TEXT,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "submittedVia" TEXT NOT NULL,
  "supersededAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReadinessSubmission_assignmentId_createdAt_idx"
  ON "ReadinessSubmission"("assignmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadinessSubmission_eventId_approvedAt_idx"
  ON "ReadinessSubmission"("eventId", "approvedAt");

DO $$ BEGIN
  ALTER TABLE "ReadinessSubmission"
    ADD CONSTRAINT "ReadinessSubmission_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "ReadinessAssignment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) ReadinessPortalAccess — hashed opaque presenter-portal token per
--    (event, speaker); IcsFeedToken shape + REQUIRED expiresAt (closes
--    conflict C9). Presenter contact email lives HERE, not on Speaker
--    (O2 as amended at ER2 — GET /speakers is member-readable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReadinessPortalAccess" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "speakerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSentAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadinessPortalAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessPortalAccess_tokenHash_key"
  ON "ReadinessPortalAccess"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessPortalAccess_eventId_speakerId_key"
  ON "ReadinessPortalAccess"("eventId", "speakerId");
CREATE INDEX IF NOT EXISTS "ReadinessPortalAccess_eventId_idx"
  ON "ReadinessPortalAccess"("eventId");
CREATE INDEX IF NOT EXISTS "ReadinessPortalAccess_speakerId_idx"
  ON "ReadinessPortalAccess"("speakerId");

DO $$ BEGIN
  ALTER TABLE "ReadinessPortalAccess"
    ADD CONSTRAINT "ReadinessPortalAccess_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReadinessPortalAccess"
    ADD CONSTRAINT "ReadinessPortalAccess_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
