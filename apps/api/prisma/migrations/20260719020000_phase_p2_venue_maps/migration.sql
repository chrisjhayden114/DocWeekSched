-- Phase P2 — Venue maps (annotated floor-plan images)
-- NOT APPLIED by the agent — review, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- VenueMap + MapPin only. No enums, no casts, no backfill.
-- imageUrl is a string from the existing storage provider (S3/R2 or data-URL fallback).
-- Reversible: see README.md.

-- ---------------------------------------------------------------------------
-- 1) VenueMap
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "VenueMap" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenueMap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VenueMap_eventId_idx"
  ON "VenueMap"("eventId");

CREATE INDEX IF NOT EXISTS "VenueMap_eventId_sortOrder_idx"
  ON "VenueMap"("eventId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "VenueMap"
    ADD CONSTRAINT "VenueMap_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) MapPin (percentage coordinates; optional Room link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MapPin" (
  "id" TEXT NOT NULL,
  "mapId" TEXT NOT NULL,
  "roomLabel" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "linkedRoomId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MapPin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MapPin_mapId_idx"
  ON "MapPin"("mapId");

CREATE INDEX IF NOT EXISTS "MapPin_linkedRoomId_idx"
  ON "MapPin"("linkedRoomId");

DO $$ BEGIN
  ALTER TABLE "MapPin"
    ADD CONSTRAINT "MapPin_mapId_fkey"
    FOREIGN KEY ("mapId") REFERENCES "VenueMap"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MapPin"
    ADD CONSTRAINT "MapPin_linkedRoomId_fkey"
    FOREIGN KEY ("linkedRoomId") REFERENCES "Room"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
