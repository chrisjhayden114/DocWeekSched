-- Phase A0 — AI gateway foundation (metering, audit, background jobs)
-- NOT APPLIED by the agent — review the FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NotificationKind: ADD VALUE 'AGENT_ATTENDEE_TOUCH' ONLY in section 1.
--    It is NEVER inserted, compared as an enum literal, or used in CASE/WHEN
--    as a "NotificationKind" value anywhere else in this file. Postgres forbids
--    using a freshly-added enum value in the same transaction.
--    DIGEST-class mapping for AGENT_ATTENDEE_TOUCH is app-layer post-migrate.
-- 2) New CREATE TYPE enums (BackgroundJobStatus, AiMeterFeature, AuditAction) are
--    used ONLY on tables created in this same migration — that is allowed.
-- 3) Additive only: no ALTER of existing NOT NULL columns, no row backfills.
--
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) NotificationKind — ISOLATED ADD VALUE ONLY
--    Do not reference AGENT_ATTENDEE_TOUCH anywhere else in this migration.
-- ---------------------------------------------------------------------------
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'AGENT_ATTENDEE_TOUCH';

-- ---------------------------------------------------------------------------
-- 2) New enums (safe to use on new tables in this migration)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "BackgroundJobStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'DEAD'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AiMeterFeature" AS ENUM (
    'AGENDA_INGEST',
    'CONCIERGE',
    'SETUP_COPILOT',
    'MATCHMAKER',
    'OPS_DRAFT',
    'RECAP',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'AI_CHAT',
    'AI_EXTRACT',
    'AI_DRAFT',
    'AI_TOOL',
    'AI_NOTIFY',
    'JOB_ENQUEUE',
    'JOB_COMPLETE',
    'JOB_FAIL',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) AiUsageRecord (per-call metering)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT,
  "userId" TEXT,
  "feature" "AiMeterFeature" NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "costEstimateCents" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "jobId" TEXT,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiUsageRecord_organizationId_createdAt_idx"
  ON "AiUsageRecord"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "AiUsageRecord_eventId_feature_createdAt_idx"
  ON "AiUsageRecord"("eventId", "feature", "createdAt");

CREATE INDEX IF NOT EXISTS "AiUsageRecord_organizationId_feature_createdAt_idx"
  ON "AiUsageRecord"("organizationId", "feature", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AiUsageRecord"
    ADD CONSTRAINT "AiUsageRecord_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiUsageRecord"
    ADD CONSTRAINT "AiUsageRecord_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiUsageRecord"
    ADD CONSTRAINT "AiUsageRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) AuditLog (agent drafts/actions; Phase 7 merges sensitive actions here)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "eventId" TEXT,
  "actorUserId" TEXT,
  "action" "AuditAction" NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx"
  ON "AuditLog"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_eventId_createdAt_idx"
  ON "AuditLog"("eventId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_aiGenerated_createdAt_idx"
  ON "AuditLog"("aiGenerated", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) BackgroundJob (progress-polling job infra)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BackgroundJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "eventId" TEXT,
  "createdById" TEXT,
  "type" TEXT NOT NULL,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "progressMessage" TEXT,
  "input" JSONB NOT NULL DEFAULT '{}',
  "result" JSONB,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BackgroundJob_status_scheduledAt_idx"
  ON "BackgroundJob"("status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "BackgroundJob_organizationId_createdAt_idx"
  ON "BackgroundJob"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "BackgroundJob_eventId_type_createdAt_idx"
  ON "BackgroundJob"("eventId", "type", "createdAt");

DO $$ BEGIN
  ALTER TABLE "BackgroundJob"
    ADD CONSTRAINT "BackgroundJob_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BackgroundJob"
    ADD CONSTRAINT "BackgroundJob_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BackgroundJob"
    ADD CONSTRAINT "BackgroundJob_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
