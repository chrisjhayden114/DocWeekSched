-- Phase A6 — Post-Event Recap Agent (workspace + draftable sections/emails)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. AiMeterFeature (incl. RECAP), AuditAction,
--    BackgroundJobStatus, NotificationKind, etc. are UNTOUCHED.
-- 2) RecapStatus, RecapSectionKind, RecapSectionStatus, RecapEmailKind,
--    RecapEmailStatus are NEW CREATE TYPEs used ONLY on tables created here.
-- 3) Additive only: THREE new tables (EventRecap, EventRecapSection,
--    EventRecapEmail). ZERO ALTER TABLE on existing tables.
-- 4) EventMembership (including checkInCode) is UNTOUCHED.
-- 5) Soft links (plain TEXT, no FK): EventRecap.lastJobId,
--    EventRecapEmail.sentViaAnnouncementId.
-- 6) Real FK: EventRecapSection.sponsorId → Sponsor ON DELETE CASCADE.
-- 7) Three PARTIAL unique indexes for live (non-SUPERSEDED) drafts — see below.
-- 8) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use on new tables in this migration — not ADD VALUE)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "RecapStatus" AS ENUM (
    'PENDING',
    'GENERATING',
    'READY',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecapSectionKind" AS ENUM (
    'REPORT',
    'FEEDBACK_SYNTHESIS',
    'CERTIFICATES',
    'SPONSOR_ONE_PAGER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecapSectionStatus" AS ENUM (
    'DRAFT',
    'SUPERSEDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecapEmailKind" AS ENUM (
    'CERTIFICATE_AVAILABILITY',
    'THANK_YOU_ATTENDEE',
    'THANK_YOU_SPEAKER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecapEmailStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'SUPERSEDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) EventRecap — one workspace per event
--    lastJobId is a SOFT link to BackgroundJob.id (no FK — jobs may be pruned).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventRecap" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "RecapStatus" NOT NULL DEFAULT 'PENDING',
  "metricsSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "feedbackQuoteBank" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "fixNextYear" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "generatedAt" TIMESTAMP(3),
  "regeneratedAt" TIMESTAMP(3),
  "lastJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventRecap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventRecap_eventId_key"
  ON "EventRecap"("eventId");
CREATE INDEX IF NOT EXISTS "EventRecap_organizationId_idx"
  ON "EventRecap"("organizationId");
CREATE INDEX IF NOT EXISTS "EventRecap_organizationId_createdAt_idx"
  ON "EventRecap"("organizationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "EventRecap"
    ADD CONSTRAINT "EventRecap_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EventRecap"
    ADD CONSTRAINT "EventRecap_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) EventRecapSection — report / feedback / certificates / sponsor one-pagers
--    sponsorId is a REAL FK → Sponsor ON DELETE CASCADE.
--    Live-draft uniqueness via PARTIAL unique indexes (status <> SUPERSEDED).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventRecapSection" (
  "id" TEXT NOT NULL,
  "recapId" TEXT NOT NULL,
  "kind" "RecapSectionKind" NOT NULL,
  "status" "RecapSectionStatus" NOT NULL DEFAULT 'DRAFT',
  "sponsorId" TEXT,
  "title" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL DEFAULT '',
  "structured" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
  "metered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventRecapSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EventRecapSection_recapId_kind_idx"
  ON "EventRecapSection"("recapId", "kind");
CREATE INDEX IF NOT EXISTS "EventRecapSection_recapId_status_createdAt_idx"
  ON "EventRecapSection"("recapId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "EventRecapSection_sponsorId_idx"
  ON "EventRecapSection"("sponsorId");

-- Live draft: at most one non-superseded section per (recapId, kind) when no sponsor
CREATE UNIQUE INDEX IF NOT EXISTS "EventRecapSection_live_recapId_kind_key"
  ON "EventRecapSection"("recapId", "kind")
  WHERE "sponsorId" IS NULL AND "status" <> 'SUPERSEDED'::"RecapSectionStatus";

-- Live draft: at most one non-superseded section per (recapId, kind, sponsorId)
CREATE UNIQUE INDEX IF NOT EXISTS "EventRecapSection_live_recapId_kind_sponsorId_key"
  ON "EventRecapSection"("recapId", "kind", "sponsorId")
  WHERE "sponsorId" IS NOT NULL AND "status" <> 'SUPERSEDED'::"RecapSectionStatus";

DO $$ BEGIN
  ALTER TABLE "EventRecapSection"
    ADD CONSTRAINT "EventRecapSection_recapId_fkey"
    FOREIGN KEY ("recapId") REFERENCES "EventRecap"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EventRecapSection"
    ADD CONSTRAINT "EventRecapSection_sponsorId_fkey"
    FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) EventRecapEmail — certificate availability + thank-yous (draft / sent)
--    sentViaAnnouncementId is a SOFT link to Announcement.id (no FK).
--    Live uniqueness via PARTIAL unique index (status <> SUPERSEDED).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventRecapEmail" (
  "id" TEXT NOT NULL,
  "recapId" TEXT NOT NULL,
  "kind" "RecapEmailKind" NOT NULL,
  "status" "RecapEmailStatus" NOT NULL DEFAULT 'DRAFT',
  "audienceRole" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3),
  "sentViaAnnouncementId" TEXT,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventRecapEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EventRecapEmail_recapId_kind_idx"
  ON "EventRecapEmail"("recapId", "kind");
CREATE INDEX IF NOT EXISTS "EventRecapEmail_recapId_status_createdAt_idx"
  ON "EventRecapEmail"("recapId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "EventRecapEmail_sentAt_idx"
  ON "EventRecapEmail"("sentAt");

-- Live draft/sent: at most one non-superseded email per (recapId, kind)
CREATE UNIQUE INDEX IF NOT EXISTS "EventRecapEmail_live_recapId_kind_key"
  ON "EventRecapEmail"("recapId", "kind")
  WHERE "status" <> 'SUPERSEDED'::"RecapEmailStatus";

DO $$ BEGIN
  ALTER TABLE "EventRecapEmail"
    ADD CONSTRAINT "EventRecapEmail_recapId_fkey"
    FOREIGN KEY ("recapId") REFERENCES "EventRecap"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
