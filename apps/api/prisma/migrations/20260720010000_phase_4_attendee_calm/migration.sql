-- Phase 4 — Attendee baseline + Calm Notification System
-- NOT APPLIED by the agent — review the FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NotificationKind: the 7 new labels are ADD VALUE ONLY in section 1.
--    They are NEVER inserted, compared as enum literals, or used in CASE/WHEN
--    as "NotificationKind" values anywhere else in this file. Postgres forbids
--    using a freshly-added enum value in the same transaction.
--    UserNotification class backfill compares via "kind"::text against EXISTING
--    labels only (MESSAGE, ADMIN_REQUEST, WAITLIST_PROMOTED / else → DIGEST).
-- 2) UserNotification.class / delivery: added NULLABLE → backfill with explicit
--    casts → then SET NOT NULL + defaults (section 8). Existing live rows are
--    preserved.
-- 3) EventMembership.directoryOptIn DEFAULT false — privacy-first. NO backfill
--    grandfathering existing members to opted-in.
--
-- Newly CREATE TYPE'd enums (NotificationClass, etc.) ARE used in this migration
-- — that is allowed.
--
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) NotificationKind — ISOLATED ADD VALUE ONLY
--    Do not reference these 7 labels anywhere else in this migration.
-- ---------------------------------------------------------------------------
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'MEETING_REQUEST';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'MEETING_ACCEPTED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SESSION_CHANGED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SESSION_STARTING_SOON';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'DIGEST_ROLLUP';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'USER_REPORT';

-- ---------------------------------------------------------------------------
-- 2) New enums (safe to use in the same migration)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "NotificationClass" AS ENUM ('INTERRUPT', 'DIGEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationDelivery" AS ENUM (
    'INBOX',
    'QUEUED_PUSH',
    'PUSHED',
    'DIGESTED',
    'SUPPRESSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnnouncementAudience" AS ENUM (
    'EVERYONE',
    'ROLE',
    'SESSION_JOINERS',
    'ATTENDANCE_MODE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MeetingRequestStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'DECLINED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ModerationReportStatus" AS ENUM (
    'OPEN',
    'REVIEWED',
    'DISMISSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PersonalAgendaSource" AS ENUM ('MEETING', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) User profile fields (nullable; no backfill)
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "affiliation" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;

-- ---------------------------------------------------------------------------
-- 4) Directory opt-in — DEFAULT false, NO grandfathering
-- ---------------------------------------------------------------------------
ALTER TABLE "EventMembership"
  ADD COLUMN IF NOT EXISTS "directoryOptIn" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 5) NotificationPreference
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT,
  "quietHoursStart" TEXT NOT NULL DEFAULT '22:00',
  "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
  "digestLocalTime" TEXT NOT NULL DEFAULT '07:30',
  "digestEmail" BOOLEAN NOT NULL DEFAULT false,
  "mutedCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "timezone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationPreference_userId_idx"
  ON "NotificationPreference"("userId");

CREATE INDEX IF NOT EXISTS "NotificationPreference_eventId_idx"
  ON "NotificationPreference"("eventId");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_global_key"
  ON "NotificationPreference"("userId")
  WHERE "eventId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_eventId_key"
  ON "NotificationPreference"("userId", "eventId")
  WHERE "eventId" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) NotificationPushDay
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "NotificationPushDay" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "pushCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPushDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPushDay_userId_dayKey_key"
  ON "NotificationPushDay"("userId", "dayKey");

CREATE INDEX IF NOT EXISTS "NotificationPushDay_userId_idx"
  ON "NotificationPushDay"("userId");

DO $$ BEGIN
  ALTER TABLE "NotificationPushDay"
    ADD CONSTRAINT "NotificationPushDay_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 7) MeetingRequest + MeetingSlot + PersonalAgendaBlock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MeetingRequest" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" "MeetingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "MeetingRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MeetingRequest_eventId_idx"
  ON "MeetingRequest"("eventId");

CREATE INDEX IF NOT EXISTS "MeetingRequest_fromUserId_idx"
  ON "MeetingRequest"("fromUserId");

CREATE INDEX IF NOT EXISTS "MeetingRequest_toUserId_idx"
  ON "MeetingRequest"("toUserId");

CREATE INDEX IF NOT EXISTS "MeetingRequest_eventId_status_idx"
  ON "MeetingRequest"("eventId", "status");

DO $$ BEGIN
  ALTER TABLE "MeetingRequest"
    ADD CONSTRAINT "MeetingRequest_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MeetingRequest"
    ADD CONSTRAINT "MeetingRequest_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MeetingRequest"
    ADD CONSTRAINT "MeetingRequest_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MeetingSlot" (
  "id" TEXT NOT NULL,
  "meetingRequestId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MeetingSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MeetingSlot_meetingRequestId_idx"
  ON "MeetingSlot"("meetingRequestId");

DO $$ BEGIN
  ALTER TABLE "MeetingSlot"
    ADD CONSTRAINT "MeetingSlot_meetingRequestId_fkey"
    FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PersonalAgendaBlock" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "source" "PersonalAgendaSource" NOT NULL DEFAULT 'MEETING',
  "meetingRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalAgendaBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PersonalAgendaBlock_userId_eventId_idx"
  ON "PersonalAgendaBlock"("userId", "eventId");

CREATE INDEX IF NOT EXISTS "PersonalAgendaBlock_eventId_startsAt_idx"
  ON "PersonalAgendaBlock"("eventId", "startsAt");

CREATE INDEX IF NOT EXISTS "PersonalAgendaBlock_meetingRequestId_idx"
  ON "PersonalAgendaBlock"("meetingRequestId");

DO $$ BEGIN
  ALTER TABLE "PersonalAgendaBlock"
    ADD CONSTRAINT "PersonalAgendaBlock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PersonalAgendaBlock"
    ADD CONSTRAINT "PersonalAgendaBlock_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PersonalAgendaBlock"
    ADD CONSTRAINT "PersonalAgendaBlock_meetingRequestId_fkey"
    FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 8) UserNotification — NULLABLE → backfill (kind::text) → NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "class" "NotificationClass";

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "delivery" "NotificationDelivery";

-- Backfill: kind::text against PRE-EXISTING labels only. New NotificationKind
-- values from section 1 are NOT referenced as enum literals here.
UPDATE "UserNotification"
SET
  "class" = CASE
    WHEN "kind"::text IN ('MESSAGE', 'ADMIN_REQUEST', 'WAITLIST_PROMOTED')
      THEN 'INTERRUPT'::"NotificationClass"
    ELSE 'DIGEST'::"NotificationClass"
  END
WHERE "class" IS NULL;

UPDATE "UserNotification"
SET "delivery" = 'INBOX'::"NotificationDelivery"
WHERE "delivery" IS NULL;

ALTER TABLE "UserNotification"
  ALTER COLUMN "class" SET DEFAULT 'DIGEST'::"NotificationClass";
ALTER TABLE "UserNotification"
  ALTER COLUMN "class" SET NOT NULL;

ALTER TABLE "UserNotification"
  ALTER COLUMN "delivery" SET DEFAULT 'INBOX'::"NotificationDelivery";
ALTER TABLE "UserNotification"
  ALTER COLUMN "delivery" SET NOT NULL;

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "queuedUntil" TIMESTAMP(3);

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "announcementId" TEXT;

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "meetingRequestId" TEXT;

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "pushDedupKey" TEXT;

ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "budgetCharged" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx"
  ON "UserNotification"("userId", "readAt");

CREATE INDEX IF NOT EXISTS "UserNotification_delivery_queuedUntil_idx"
  ON "UserNotification"("delivery", "queuedUntil");

CREATE INDEX IF NOT EXISTS "UserNotification_userId_class_createdAt_idx"
  ON "UserNotification"("userId", "class", "createdAt");

CREATE INDEX IF NOT EXISTS "UserNotification_announcementId_idx"
  ON "UserNotification"("announcementId");

CREATE INDEX IF NOT EXISTS "UserNotification_meetingRequestId_idx"
  ON "UserNotification"("meetingRequestId");

CREATE INDEX IF NOT EXISTS "UserNotification_sessionId_idx"
  ON "UserNotification"("sessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotification_pushDedupKey_key"
  ON "UserNotification"("pushDedupKey")
  WHERE "pushDedupKey" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_meetingRequestId_fkey"
    FOREIGN KEY ("meetingRequestId") REFERENCES "MeetingRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 9) Announcement expand
-- ---------------------------------------------------------------------------
ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "audience" "AnnouncementAudience";

UPDATE "Announcement"
SET "audience" = 'EVERYONE'::"AnnouncementAudience"
WHERE "audience" IS NULL;

ALTER TABLE "Announcement"
  ALTER COLUMN "audience" SET DEFAULT 'EVERYONE'::"AnnouncementAudience";
ALTER TABLE "Announcement"
  ALTER COLUMN "audience" SET NOT NULL;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "audienceRole" "EventMemberRole";

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "attendanceMode" "SessionJoinMode";

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "sendEmail" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "isEmergency" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "isPreview" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "Announcement"
SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;

ALTER TABLE "Announcement"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Announcement"
  ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Announcement_eventId_createdAt_idx"
  ON "Announcement"("eventId", "createdAt");

CREATE INDEX IF NOT EXISTS "Announcement_sessionId_idx"
  ON "Announcement"("sessionId");

CREATE INDEX IF NOT EXISTS "Announcement_createdById_idx"
  ON "Announcement"("createdById");

DO $$ BEGIN
  ALTER TABLE "Announcement"
    ADD CONSTRAINT "Announcement_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Announcement"
    ADD CONSTRAINT "Announcement_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 10) AnnouncementAuditLog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AnnouncementAuditLog" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnnouncementAuditLog_announcementId_idx"
  ON "AnnouncementAuditLog"("announcementId");

CREATE INDEX IF NOT EXISTS "AnnouncementAuditLog_eventId_createdAt_idx"
  ON "AnnouncementAuditLog"("eventId", "createdAt");

CREATE INDEX IF NOT EXISTS "AnnouncementAuditLog_actorId_idx"
  ON "AnnouncementAuditLog"("actorId");

DO $$ BEGIN
  ALTER TABLE "AnnouncementAuditLog"
    ADD CONSTRAINT "AnnouncementAuditLog_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AnnouncementAuditLog"
    ADD CONSTRAINT "AnnouncementAuditLog_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AnnouncementAuditLog"
    ADD CONSTRAINT "AnnouncementAuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 11) UserBlock + UserReport
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id" TEXT NOT NULL,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_blockerId_blockedId_eventId_key"
  ON "UserBlock"("blockerId", "blockedId", "eventId");

CREATE INDEX IF NOT EXISTS "UserBlock_eventId_idx"
  ON "UserBlock"("eventId");

CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx"
  ON "UserBlock"("blockedId");

DO $$ BEGIN
  ALTER TABLE "UserBlock"
    ADD CONSTRAINT "UserBlock_blockerId_fkey"
    FOREIGN KEY ("blockerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserBlock"
    ADD CONSTRAINT "UserBlock_blockedId_fkey"
    FOREIGN KEY ("blockedId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserBlock"
    ADD CONSTRAINT "UserBlock_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reportedUserId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" "ModerationReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolverId" TEXT,
  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserReport_eventId_status_idx"
  ON "UserReport"("eventId", "status");

CREATE INDEX IF NOT EXISTS "UserReport_reporterId_idx"
  ON "UserReport"("reporterId");

CREATE INDEX IF NOT EXISTS "UserReport_reportedUserId_idx"
  ON "UserReport"("reportedUserId");

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_reportedUserId_fkey"
    FOREIGN KEY ("reportedUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_resolverId_fkey"
    FOREIGN KEY ("resolverId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 12) IcsFeedToken
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IcsFeedToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "IcsFeedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IcsFeedToken_tokenHash_key"
  ON "IcsFeedToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "IcsFeedToken_userId_eventId_idx"
  ON "IcsFeedToken"("userId", "eventId");

DO $$ BEGIN
  ALTER TABLE "IcsFeedToken"
    ADD CONSTRAINT "IcsFeedToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IcsFeedToken"
    ADD CONSTRAINT "IcsFeedToken_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 13) PushSubscription
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key"
  ON "PushSubscription"("endpoint");

CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx"
  ON "PushSubscription"("userId");

DO $$ BEGIN
  ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
