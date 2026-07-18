-- Phase P4 — Badges & certificates (templates + issued certificates)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. NotificationKind, EventMemberRole,
--    CheckInMethod, SessionAttendanceStatus, BackgroundJobStatus, etc. are UNTOUCHED.
-- 2) BadgeSheetSize + CertificateEligibilityRule are NEW CREATE TYPEs used ONLY
--    on tables created in this migration — fine in one transaction.
-- 3) Additive only: THREE new tables (BadgeTemplate, CertificateTemplate,
--    IssuedCertificate). ZERO ALTER TABLE on existing tables.
-- 4) EventMembership (including checkInCode) is UNTOUCHED.
-- 5) IssuedCertificate has issuedAt (set once), regeneratedAt (nullable),
--    voidedAt (nullable). Unique on publicId and (certificateTemplateId, userId).
-- 6) IssuedCertificate_certificateTemplateId_fkey is ON DELETE RESTRICT
--    (not CASCADE). Templates cannot be destroyed while issued rows exist —
--    void via voidedAt first. userId remains ON DELETE CASCADE (GDPR erasure).
-- 7) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use on new tables in this migration — not ADD VALUE)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "BadgeSheetSize" AS ENUM (
    'SIZE_3X4',
    'SIZE_4X6',
    'SIZE_A6'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CertificateEligibilityRule" AS ENUM (
    'ANY_CHECKIN',
    'MIN_SESSIONS',
    'REQUIRED_SESSIONS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) BadgeTemplate — one layout config per event (Avery sheet sizes + toggles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BadgeTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sheetSize" "BadgeSheetSize" NOT NULL DEFAULT 'SIZE_3X4',
  "showLogo" BOOLEAN NOT NULL DEFAULT true,
  "showName" BOOLEAN NOT NULL DEFAULT true,
  "showAffiliation" BOOLEAN NOT NULL DEFAULT true,
  "showRole" BOOLEAN NOT NULL DEFAULT true,
  "showQr" BOOLEAN NOT NULL DEFAULT true,
  "showBrandColorBar" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BadgeTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BadgeTemplate_eventId_key"
  ON "BadgeTemplate"("eventId");
CREATE INDEX IF NOT EXISTS "BadgeTemplate_organizationId_idx"
  ON "BadgeTemplate"("organizationId");

DO $$ BEGIN
  ALTER TABLE "BadgeTemplate"
    ADD CONSTRAINT "BadgeTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BadgeTemplate"
    ADD CONSTRAINT "BadgeTemplate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) CertificateTemplate — merge fields + eligibility rule (JOINING = registration)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CertificateTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "titleText" TEXT NOT NULL,
  "bodyText" TEXT,
  "signatureImageUrl" TEXT,
  "hours" DOUBLE PRECISION,
  "eligibilityRule" "CertificateEligibilityRule" NOT NULL,
  "minSessions" INTEGER,
  "requiredSessionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CertificateTemplate_eventId_idx"
  ON "CertificateTemplate"("eventId");
CREATE INDEX IF NOT EXISTS "CertificateTemplate_organizationId_idx"
  ON "CertificateTemplate"("organizationId");
CREATE INDEX IF NOT EXISTS "CertificateTemplate_eventId_eligibilityRule_idx"
  ON "CertificateTemplate"("eventId", "eligibilityRule");

DO $$ BEGIN
  ALTER TABLE "CertificateTemplate"
    ADD CONSTRAINT "CertificateTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CertificateTemplate"
    ADD CONSTRAINT "CertificateTemplate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) IssuedCertificate
--    publicId = app-generated 128-bit randomBytes(16).base64url (UNIQUE)
--    @@unique(certificateTemplateId, userId) = idempotent re-issue
--    issuedAt set once; regeneratedAt on re-issue; voidedAt reserved for revoke
--    (/verify treats voidedAt IS NOT NULL as miss → identical 404)
--    certificateTemplateId FK: ON DELETE RESTRICT (void before deleting template)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IssuedCertificate" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "certificateTemplateId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attendeeNameSnapshot" TEXT NOT NULL,
  "eventNameSnapshot" TEXT NOT NULL,
  "eventDateSnapshot" TIMESTAMP(3) NOT NULL,
  "hoursSnapshot" DOUBLE PRECISION,
  "pdfStorageKey" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "regeneratedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "issuedByUserId" TEXT,
  "batchJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssuedCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IssuedCertificate_publicId_key"
  ON "IssuedCertificate"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "IssuedCertificate_certificateTemplateId_userId_key"
  ON "IssuedCertificate"("certificateTemplateId", "userId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_eventId_idx"
  ON "IssuedCertificate"("eventId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_organizationId_idx"
  ON "IssuedCertificate"("organizationId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_userId_idx"
  ON "IssuedCertificate"("userId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_certificateTemplateId_idx"
  ON "IssuedCertificate"("certificateTemplateId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_issuedByUserId_idx"
  ON "IssuedCertificate"("issuedByUserId");
CREATE INDEX IF NOT EXISTS "IssuedCertificate_voidedAt_idx"
  ON "IssuedCertificate"("voidedAt");

DO $$ BEGIN
  ALTER TABLE "IssuedCertificate"
    ADD CONSTRAINT "IssuedCertificate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IssuedCertificate"
    ADD CONSTRAINT "IssuedCertificate_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IssuedCertificate"
    ADD CONSTRAINT "IssuedCertificate_certificateTemplateId_fkey"
    FOREIGN KEY ("certificateTemplateId") REFERENCES "CertificateTemplate"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IssuedCertificate"
    ADD CONSTRAINT "IssuedCertificate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IssuedCertificate"
    ADD CONSTRAINT "IssuedCertificate_issuedByUserId_fkey"
    FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
