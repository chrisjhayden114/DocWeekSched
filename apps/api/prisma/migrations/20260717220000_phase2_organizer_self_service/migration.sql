-- Phase 2: organizer self-service (EventSeries, Track, Room, Speaker, SessionItem, event enrichments)
-- Idempotent / re-runnable. Explicit enum casts. Do NOT edit prior migration folders.
-- IMPORTANT: existing events are set to ACTIVE (Published) so pre-Phase-2 public links keep working.
-- Newly created events (app layer) default to DRAFT.

--------------------------------------------------------------------------------
-- 1) EventSeries + continuity consent
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "EventSeries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "setupChecklist" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventSeries_organizationId_slug_key"
  ON "EventSeries"("organizationId", "slug");
CREATE INDEX IF NOT EXISTS "EventSeries_organizationId_idx"
  ON "EventSeries"("organizationId");

DO $$ BEGIN
  ALTER TABLE "EventSeries"
    ADD CONSTRAINT "EventSeries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SeriesContinuityConsent" (
  "id" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeriesContinuityConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeriesContinuityConsent_seriesId_userId_key"
  ON "SeriesContinuityConsent"("seriesId", "userId");
CREATE INDEX IF NOT EXISTS "SeriesContinuityConsent_userId_idx"
  ON "SeriesContinuityConsent"("userId");

DO $$ BEGIN
  ALTER TABLE "SeriesContinuityConsent"
    ADD CONSTRAINT "SeriesContinuityConsent_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SeriesContinuityConsent"
    ADD CONSTRAINT "SeriesContinuityConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 2) Event enrichments (nullable / optional first)
--------------------------------------------------------------------------------

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venueName" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venueAddress" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "onlineUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "brandColor" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;

CREATE INDEX IF NOT EXISTS "Event_seriesId_idx" ON "Event"("seriesId");

DO $$ BEGIN
  ALTER TABLE "Event"
    ADD CONSTRAINT "Event_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Existing events were always public under pre-Phase-2 rules → mark Published (ACTIVE).
-- Only newly created events (application default DRAFT) stay draft after this migration.
UPDATE "Event"
SET "status" = 'ACTIVE'::"EventStatus"
WHERE "status" IS DISTINCT FROM 'ACTIVE'::"EventStatus"
  AND "status" IS DISTINCT FROM 'ARCHIVED'::"EventStatus";

-- If any row somehow has NULL status (should not), force ACTIVE
UPDATE "Event"
SET "status" = 'ACTIVE'::"EventStatus"
WHERE "status" IS NULL;

--------------------------------------------------------------------------------
-- 3) Track + Room (per event)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Track" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Track_eventId_name_key" ON "Track"("eventId", "name");
CREATE INDEX IF NOT EXISTS "Track_eventId_idx" ON "Track"("eventId");

DO $$ BEGIN
  ALTER TABLE "Track"
    ADD CONSTRAINT "Track_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Room" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Room_eventId_name_key" ON "Room"("eventId", "name");
CREATE INDEX IF NOT EXISTS "Room_eventId_idx" ON "Room"("eventId");

DO $$ BEGIN
  ALTER TABLE "Room"
    ADD CONSTRAINT "Room_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 4) Speaker (event-scoped; no User login required)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Speaker" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "affiliation" TEXT,
  "bio" TEXT,
  "photoUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Speaker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Speaker_eventId_idx" ON "Speaker"("eventId");

DO $$ BEGIN
  ALTER TABLE "Speaker"
    ADD CONSTRAINT "Speaker_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SessionSpeaker" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "speakerId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SessionSpeaker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionSpeaker_sessionId_speakerId_key"
  ON "SessionSpeaker"("sessionId", "speakerId");
CREATE INDEX IF NOT EXISTS "SessionSpeaker_speakerId_idx" ON "SessionSpeaker"("speakerId");

DO $$ BEGIN
  ALTER TABLE "SessionSpeaker"
    ADD CONSTRAINT "SessionSpeaker_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionSpeaker"
    ADD CONSTRAINT "SessionSpeaker_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 5) SessionItem + authors (authored order via sortOrder — never alphabetize in app)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SessionItem" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "abstract" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "discussantName" TEXT,
  "discussantSpeakerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionItem_sessionId_sortOrder_idx"
  ON "SessionItem"("sessionId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "SessionItem"
    ADD CONSTRAINT "SessionItem_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionItem"
    ADD CONSTRAINT "SessionItem_discussantSpeakerId_fkey"
    FOREIGN KEY ("discussantSpeakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SessionItemAuthor" (
  "id" TEXT NOT NULL,
  "sessionItemId" TEXT NOT NULL,
  "speakerId" TEXT,
  "name" TEXT NOT NULL,
  "isPresenter" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SessionItemAuthor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionItemAuthor_sessionItemId_sortOrder_idx"
  ON "SessionItemAuthor"("sessionItemId", "sortOrder");
CREATE INDEX IF NOT EXISTS "SessionItemAuthor_speakerId_idx"
  ON "SessionItemAuthor"("speakerId");

DO $$ BEGIN
  ALTER TABLE "SessionItemAuthor"
    ADD CONSTRAINT "SessionItemAuthor_sessionItemId_fkey"
    FOREIGN KEY ("sessionItemId") REFERENCES "SessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SessionItemAuthor"
    ADD CONSTRAINT "SessionItemAuthor_speakerId_fkey"
    FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 6) Session.trackId / roomId (keep free-text location + speakers columns)
--------------------------------------------------------------------------------

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "trackId" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "roomId" TEXT;

CREATE INDEX IF NOT EXISTS "Session_trackId_idx" ON "Session"("trackId");
CREATE INDEX IF NOT EXISTS "Session_roomId_idx" ON "Session"("roomId");

DO $$ BEGIN
  ALTER TABLE "Session"
    ADD CONSTRAINT "Session_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Session"
    ADD CONSTRAINT "Session_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 7) Backfill Room from distinct Session.location (free-text kept on Session)
--------------------------------------------------------------------------------

-- Create one Room per (eventId, trimmed location) for non-empty locations
INSERT INTO "Room" ("id", "eventId", "name", "sortOrder", "createdAt")
SELECT
  'room_bf_' || md5(s."eventId" || E'\n' || trim(s."location")),
  s."eventId",
  trim(s."location"),
  0,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "eventId", trim("location") AS "location"
  FROM "Session"
  WHERE "location" IS NOT NULL AND length(trim("location")) > 0
) s
ON CONFLICT ("eventId", "name") DO NOTHING;

-- Link sessions to rooms by matching trimmed location name
UPDATE "Session" sess
SET "roomId" = r."id"
FROM "Room" r
WHERE sess."roomId" IS NULL
  AND sess."location" IS NOT NULL
  AND length(trim(sess."location")) > 0
  AND r."eventId" = sess."eventId"
  AND r."name" = trim(sess."location");

--------------------------------------------------------------------------------
-- 8) Optional forward-compat for object storage keys on resources
--------------------------------------------------------------------------------

ALTER TABLE "SessionResource" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;

--------------------------------------------------------------------------------
-- Rollback sketch (manual — reverse of this migration):
-- ALTER TABLE "SessionResource" DROP COLUMN IF EXISTS "storageKey";
-- ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_roomId_fkey";
-- ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_trackId_fkey";
-- ALTER TABLE "Session" DROP COLUMN IF EXISTS "roomId";
-- ALTER TABLE "Session" DROP COLUMN IF EXISTS "trackId";
-- DROP TABLE IF EXISTS "SessionItemAuthor", "SessionItem", "SessionSpeaker", "Speaker", "Room", "Track";
-- ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_seriesId_fkey";
-- ALTER TABLE "Event" DROP COLUMN IF EXISTS "seriesId", "brandColor", "onlineUrl", "venueAddress", "venueName", "description";
-- DROP TABLE IF EXISTS "SeriesContinuityConsent", "EventSeries";
-- Note: Event.status values left as-is on rollback (ACTIVE remains); app would stop enforcing publish gates.
