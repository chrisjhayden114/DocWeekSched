-- Phase P3 migration 2/2 — CFP tables (forms, submissions, reviews, decisions)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Migration 1 (prior folder) added EventMemberRole.REVIEWER via ADD VALUE ONLY.
--    This file NEVER inserts, updates, compares, or CASEs the literal 'REVIEWER'.
--    Reviewer EventMembership assignment is APP-LAYER post-migrate.
-- 2) CfpFormStatus, CfpSubmissionStatus, CfpDecisionEmailKind are NEW CREATE TYPEs
--    used ONLY on tables created in this migration — fine in one transaction.
-- 3) Additive only: no ALTER of existing NOT NULL columns, no row backfills.
-- 4) Submission verify/access tokens are stored as HASH columns (verifyTokenHash,
--    accessTokenHash) — never plaintext (same pattern as Phase 1 invite tokens).
-- 5) No NotificationKind (or other existing-enum) ADD VALUE in this file.
--
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use on new tables in this migration)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "CfpFormStatus" AS ENUM (
    'DRAFT',
    'OPEN',
    'CLOSED',
    'ARCHIVED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CfpSubmissionStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'ACCEPTED',
    'REJECTED',
    'WITHDRAWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CfpDecisionEmailKind" AS ENUM (
    'ACCEPT',
    'REJECT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) CfpForm
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpForm" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "opensAt" TIMESTAMP(3) NOT NULL,
  "closesAt" TIMESTAMP(3) NOT NULL,
  "status" "CfpFormStatus" NOT NULL DEFAULT 'DRAFT',
  "customFields" JSONB NOT NULL DEFAULT '[]',
  "maxSubmissionsPerPerson" INTEGER NOT NULL DEFAULT 1,
  "blindReview" BOOLEAN NOT NULL DEFAULT true,
  "rubric" JSONB NOT NULL DEFAULT '[]',
  "acceptEmailSubject" TEXT,
  "acceptEmailBody" TEXT,
  "rejectEmailSubject" TEXT,
  "rejectEmailBody" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpForm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CfpForm_eventId_idx" ON "CfpForm"("eventId");
CREATE INDEX IF NOT EXISTS "CfpForm_eventId_status_idx" ON "CfpForm"("eventId", "status");

DO $$ BEGIN
  ALTER TABLE "CfpForm"
    ADD CONSTRAINT "CfpForm_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) CfpReviewer (committee roster for a form)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpReviewer" (
  "id" TEXT NOT NULL,
  "cfpFormId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpReviewer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CfpReviewer_cfpFormId_userId_key"
  ON "CfpReviewer"("cfpFormId", "userId");
CREATE INDEX IF NOT EXISTS "CfpReviewer_userId_idx" ON "CfpReviewer"("userId");

DO $$ BEGIN
  ALTER TABLE "CfpReviewer"
    ADD CONSTRAINT "CfpReviewer_cfpFormId_fkey"
    FOREIGN KEY ("cfpFormId") REFERENCES "CfpForm"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpReviewer"
    ADD CONSTRAINT "CfpReviewer_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) CfpSubmission
--     verifyTokenHash / accessTokenHash = HASHED at rest (never plaintext)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpSubmission" (
  "id" TEXT NOT NULL,
  "cfpFormId" TEXT NOT NULL,
  "submitterName" TEXT NOT NULL,
  "submitterEmail" TEXT NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "verifyTokenHash" TEXT,
  "accessTokenHash" TEXT,
  "title" TEXT NOT NULL,
  "abstract" TEXT NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "status" "CfpSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "convertedSessionId" TEXT,
  "convertedSessionItemId" TEXT,
  "convertedSpeakerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CfpSubmission_verifyTokenHash_key"
  ON "CfpSubmission"("verifyTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "CfpSubmission_accessTokenHash_key"
  ON "CfpSubmission"("accessTokenHash");
CREATE INDEX IF NOT EXISTS "CfpSubmission_cfpFormId_status_idx"
  ON "CfpSubmission"("cfpFormId", "status");
CREATE INDEX IF NOT EXISTS "CfpSubmission_cfpFormId_submitterEmail_idx"
  ON "CfpSubmission"("cfpFormId", "submitterEmail");
CREATE INDEX IF NOT EXISTS "CfpSubmission_status_idx" ON "CfpSubmission"("status");
CREATE INDEX IF NOT EXISTS "CfpSubmission_convertedSessionId_idx"
  ON "CfpSubmission"("convertedSessionId");
CREATE INDEX IF NOT EXISTS "CfpSubmission_convertedSessionItemId_idx"
  ON "CfpSubmission"("convertedSessionItemId");
CREATE INDEX IF NOT EXISTS "CfpSubmission_convertedSpeakerId_idx"
  ON "CfpSubmission"("convertedSpeakerId");

DO $$ BEGIN
  ALTER TABLE "CfpSubmission"
    ADD CONSTRAINT "CfpSubmission_cfpFormId_fkey"
    FOREIGN KEY ("cfpFormId") REFERENCES "CfpForm"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpSubmission"
    ADD CONSTRAINT "CfpSubmission_convertedSessionId_fkey"
    FOREIGN KEY ("convertedSessionId") REFERENCES "Session"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpSubmission"
    ADD CONSTRAINT "CfpSubmission_convertedSessionItemId_fkey"
    FOREIGN KEY ("convertedSessionItemId") REFERENCES "SessionItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpSubmission"
    ADD CONSTRAINT "CfpSubmission_convertedSpeakerId_fkey"
    FOREIGN KEY ("convertedSpeakerId") REFERENCES "Speaker"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) CfpAttachment (object URL or data-URL fallback — no bucket required)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpAttachment" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "storageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CfpAttachment_submissionId_idx"
  ON "CfpAttachment"("submissionId");

DO $$ BEGIN
  ALTER TABLE "CfpAttachment"
    ADD CONSTRAINT "CfpAttachment_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "CfpSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) CfpReview
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpReview" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "scores" JSONB NOT NULL DEFAULT '{}',
  "comment" TEXT,
  "recusedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CfpReview_submissionId_reviewerUserId_key"
  ON "CfpReview"("submissionId", "reviewerUserId");
CREATE INDEX IF NOT EXISTS "CfpReview_reviewerUserId_idx" ON "CfpReview"("reviewerUserId");
CREATE INDEX IF NOT EXISTS "CfpReview_submissionId_idx" ON "CfpReview"("submissionId");

DO $$ BEGIN
  ALTER TABLE "CfpReview"
    ADD CONSTRAINT "CfpReview_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "CfpSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpReview"
    ADD CONSTRAINT "CfpReview_reviewerUserId_fkey"
    FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 7) CfpDecisionEmail (queued editable accept/reject mail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CfpDecisionEmail" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "kind" "CfpDecisionEmailKind" NOT NULL,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CfpDecisionEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CfpDecisionEmail_submissionId_idx"
  ON "CfpDecisionEmail"("submissionId");
CREATE INDEX IF NOT EXISTS "CfpDecisionEmail_sentAt_idx"
  ON "CfpDecisionEmail"("sentAt");

DO $$ BEGIN
  ALTER TABLE "CfpDecisionEmail"
    ADD CONSTRAINT "CfpDecisionEmail_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "CfpSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CfpDecisionEmail"
    ADD CONSTRAINT "CfpDecisionEmail_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
