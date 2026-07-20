-- Phase 1: tenancy + security foundation (self-sufficient)
-- Creates enums/tables that existed only in schema.prisma (never drift), then backfills, then hardens.
-- Idempotent / re-runnable. Do NOT edit prior migration folders.

--------------------------------------------------------------------------------
-- 1) Missing enums (guarded CREATE TYPE)
--------------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- If an older drifted attempt created OrgRole.MEMBER, rename to STAFF
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'OrgRole' AND e.enumlabel = 'MEMBER'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'OrgRole' AND e.enumlabel = 'STAFF'
  ) THEN
    ALTER TYPE "OrgRole" RENAME VALUE 'MEMBER' TO 'STAFF';
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE "EventMemberRole" AS ENUM ('ADMIN', 'ATTENDEE', 'SPEAKER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'PRO', 'ORG_ANNUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminAccessRequestStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 2) Missing tables (transcribed from schema.prisma)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "stripeCustomerId" TEXT,
  "plan" "PlanTier",
  "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
  "stripeSubscriptionId" TEXT,
  "eventAllowance" INTEGER NOT NULL DEFAULT 0,
  "eventsIncludedUsed" INTEGER NOT NULL DEFAULT 0,
  "subscriptionEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");

CREATE TABLE IF NOT EXISTS "OrgMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "OrgRole" NOT NULL DEFAULT 'STAFF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgMembership_organizationId_userId_key" ON "OrgMembership"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "OrgMembership_userId_idx" ON "OrgMembership"("userId");

DO $$ BEGIN
  ALTER TABLE "OrgMembership"
    ADD CONSTRAINT "OrgMembership_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrgMembership"
    ADD CONSTRAINT "OrgMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "EventMembership" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "EventMemberRole" NOT NULL DEFAULT 'ATTENDEE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventMembership_eventId_userId_key" ON "EventMembership"("eventId", "userId");
CREATE INDEX IF NOT EXISTS "EventMembership_userId_idx" ON "EventMembership"("userId");

DO $$ BEGIN
  ALTER TABLE "EventMembership"
    ADD CONSTRAINT "EventMembership_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EventMembership"
    ADD CONSTRAINT "EventMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "EventPurchase" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT,
  "plan" "PlanTier" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "attendeeCap" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "EventPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventPurchase_stripeCheckoutSessionId_key" ON "EventPurchase"("stripeCheckoutSessionId");
CREATE INDEX IF NOT EXISTS "EventPurchase_organizationId_idx" ON "EventPurchase"("organizationId");
CREATE INDEX IF NOT EXISTS "EventPurchase_eventId_idx" ON "EventPurchase"("eventId");

DO $$ BEGIN
  ALTER TABLE "EventPurchase"
    ADD CONSTRAINT "EventPurchase_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EventPurchase"
    ADD CONSTRAINT "EventPurchase_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 3) Event column additions (nullable organizationId first) + User auth columns
--------------------------------------------------------------------------------

-- Billing / status fields that also drifted in schema.prisma ahead of migrations
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "status" "EventStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "plan" "PlanTier";
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "attendeeCap" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);

-- organizationId nullable until backfill completes
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "Event_organizationId_idx" ON "Event"("organizationId");

-- Invite-link controls
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "joinTokenHash" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "joinTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "joinTokenCapacity" INTEGER;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "joinTokenUseCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "joinTokenRevokedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "slugInviteEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "slugInviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "slugInviteCapacity" INTEGER;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "slugInviteUseCount" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "Event_joinTokenHash_key" ON "Event"("joinTokenHash");

-- User: email verification + hashed tokens
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileSetupTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" TEXT;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'profileSetupToken'
  ) THEN
    ALTER TABLE "User" DROP COLUMN "profileSetupToken";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'passwordResetToken'
  ) THEN
    ALTER TABLE "User" DROP COLUMN "passwordResetToken";
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "User_emailVerifyTokenHash_key" ON "User"("emailVerifyTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "User_profileSetupTokenHash_key" ON "User"("profileSetupTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash");

-- AdminAccessRequest (depends on Organization + Event + enums)
CREATE TABLE IF NOT EXISTS "AdminAccessRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AdminAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  CONSTRAINT "AdminAccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAccessRequest_organizationId_status_idx" ON "AdminAccessRequest"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "AdminAccessRequest_eventId_status_idx" ON "AdminAccessRequest"("eventId", "status");
CREATE INDEX IF NOT EXISTS "AdminAccessRequest_userId_idx" ON "AdminAccessRequest"("userId");

DO $$ BEGIN
  ALTER TABLE "AdminAccessRequest"
    ADD CONSTRAINT "AdminAccessRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAccessRequest"
    ADD CONSTRAINT "AdminAccessRequest_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAccessRequest"
    ADD CONSTRAINT "AdminAccessRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAccessRequest"
    ADD CONSTRAINT "AdminAccessRequest_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 4) Data backfill
--------------------------------------------------------------------------------

-- Grandfather existing users (email verification for NEW registrations only)
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;

-- Clear expiry on invalidated invite/reset tokens (plaintext columns dropped above)
UPDATE "User" SET
  "profileSetupTokenExpiresAt" = NULL,
  "passwordResetTokenExpiresAt" = NULL
WHERE "profileSetupTokenHash" IS NULL;

-- Default Organization
INSERT INTO "Organization" ("id", "name", "slug", "subscriptionStatus", "eventAllowance", "eventsIncludedUsed", "createdAt")
SELECT 'org_default_phase1', 'Default Organization', 'default', 'NONE'::"SubscriptionStatus", 0, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "slug" = 'default');

-- Attach events without org to default
UPDATE "Event" e
SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'default' LIMIT 1)
WHERE e."organizationId" IS NULL;

-- Migrate owner login email uky.edu -> gmail.com (uky account expires); same user + password
UPDATE "User" SET "email" = 'cjhayden114@gmail.com'
WHERE lower("email") = lower('cjhayden114@uky.edu')
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE lower("email") = lower('cjhayden114@gmail.com'));

-- Org memberships: OWNER = cjhayden114@gmail.com; other global ADMINs → org ADMIN
INSERT INTO "OrgMembership" ("id", "organizationId", "userId", "role", "createdAt")
SELECT
  'orgmem_owner_' || u."id",
  (SELECT "id" FROM "Organization" WHERE "slug" = 'default' LIMIT 1),
  u."id",
  'OWNER'::"OrgRole",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE lower(u."email") = lower('cjhayden114@gmail.com')
ON CONFLICT ("organizationId", "userId") DO UPDATE SET "role" = 'OWNER';

INSERT INTO "OrgMembership" ("id", "organizationId", "userId", "role", "createdAt")
SELECT
  'orgmem_admin_' || u."id",
  (SELECT "id" FROM "Organization" WHERE "slug" = 'default' LIMIT 1),
  u."id",
  'ADMIN'::"OrgRole",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'ADMIN'
  AND lower(u."email") <> lower('cjhayden114@gmail.com')
ON CONFLICT ("organizationId", "userId") DO NOTHING;

-- EventMembership backfill
INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT
  'evmem_creator_' || e."id" || '_' || e."createdById",
  e."id",
  e."createdById",
  'ADMIN'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "Event" e
WHERE e."createdById" IS NOT NULL
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT
  'evmem_gadmin_' || e."id" || '_' || u."id",
  e."id",
  u."id",
  'ADMIN'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "Event" e
CROSS JOIN "User" u
WHERE u."role" = 'ADMIN'
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT
  'evmem_checkin_' || c."eventId" || '_' || c."userId",
  c."eventId",
  c."userId",
  'ATTENDEE'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "CheckIn" c
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT DISTINCT
  'evmem_att_' || s."eventId" || '_' || a."userId",
  s."eventId",
  a."userId",
  'ATTENDEE'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "SessionAttendance" a
JOIN "Session" s ON s."id" = a."sessionId"
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT DISTINCT
  'evmem_conv_' || c."eventId" || '_' || m."userId",
  c."eventId",
  m."userId",
  'ATTENDEE'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "ConversationMember" m
JOIN "Conversation" c ON c."id" = m."conversationId"
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT DISTINCT
  'evmem_net_' || t."eventId" || '_' || t."authorId",
  t."eventId",
  t."authorId",
  'ATTENDEE'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "NetworkThread" t
ON CONFLICT ("eventId", "userId") DO NOTHING;

INSERT INTO "EventMembership" ("id", "eventId", "userId", "role", "createdAt")
SELECT DISTINCT
  'evmem_netr_' || t."eventId" || '_' || r."authorId",
  t."eventId",
  r."authorId",
  'ATTENDEE'::"EventMemberRole",
  CURRENT_TIMESTAMP
FROM "NetworkReply" r
JOIN "NetworkThread" t ON t."id" = r."threadId"
ON CONFLICT ("eventId", "userId") DO NOTHING;

--------------------------------------------------------------------------------
-- 5) Remaining constraints (after every Event row is backfilled)
--------------------------------------------------------------------------------

DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM "Event" WHERE "organizationId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce Event.organizationId NOT NULL: % orphan events remain', orphan_count;
  END IF;
END $$;

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_organizationId_fkey";
ALTER TABLE "Event" ALTER COLUMN "organizationId" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Event"
    ADD CONSTRAINT "Event_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rollback sketch (manual):
-- ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_organizationId_fkey";
-- ALTER TABLE "Event" ALTER COLUMN "organizationId" DROP NOT NULL;
-- DROP TABLE IF EXISTS "AdminAccessRequest", "EventPurchase", "EventMembership", "OrgMembership", "Organization";
-- DROP TYPE IF EXISTS "AdminAccessRequestStatus", "SubscriptionStatus", "PurchaseStatus", "PlanTier", "EventStatus", "EventMemberRole", "OrgRole";
