-- Phase 2.6 — per-event feature configuration
-- NOT APPLIED by the agent — review, then: npx prisma migrate deploy (dev Neon branch only).
--
-- Stores organizer overrides as JSONB. Absent EventFeatureConfig row (or absent key)
-- means registry default. Turning features off never deletes attendee data.
-- Reversible: DROP TABLE IF EXISTS "EventFeatureConfig";

CREATE TABLE IF NOT EXISTS "EventFeatureConfig" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventFeatureConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventFeatureConfig_eventId_key"
    ON "EventFeatureConfig"("eventId");

DO $$ BEGIN
    ALTER TABLE "EventFeatureConfig"
        ADD CONSTRAINT "EventFeatureConfig_eventId_fkey"
        FOREIGN KEY ("eventId") REFERENCES "Event"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
