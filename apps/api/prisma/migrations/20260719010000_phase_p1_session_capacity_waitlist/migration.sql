-- Phase P1 — Session capacity + waitlist
-- NOT APPLIED by the agent — review, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- - inPersonCapacity / virtualCapacity: NULL = unlimited (no backfill).
-- - WaitlistEntry reuses SessionJoinMode; unique(sessionId, userId).
-- - NotificationKind gains WAITLIST_PROMOTED via ADD VALUE IF NOT EXISTS.
--   That label is NOT referenced anywhere else in this file (Postgres forbids
--   using a freshly-added enum value in the same transaction). App code uses
--   it after this migration commits.
-- Reversible: see README.md.

-- ---------------------------------------------------------------------------
-- 1) NotificationKind — isolated ADD VALUE only (never used in this migration)
-- ---------------------------------------------------------------------------
-- Neon / modern Postgres: ADD VALUE IF NOT EXISTS is safe inside Prisma's
-- transactional migrate when the new label is not written in the same script.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'WAITLIST_PROMOTED';

-- ---------------------------------------------------------------------------
-- 2) Session capacity (nullable = unlimited)
-- ---------------------------------------------------------------------------
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "inPersonCapacity" INTEGER;

ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "virtualCapacity" INTEGER;

-- ---------------------------------------------------------------------------
-- 3) WaitlistEntry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" "SessionJoinMode" NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "promotedAt" TIMESTAMP(3),
  "holdExpiresAt" TIMESTAMP(3),
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistEntry_sessionId_userId_key"
  ON "WaitlistEntry"("sessionId", "userId");

CREATE INDEX IF NOT EXISTS "WaitlistEntry_sessionId_mode_position_idx"
  ON "WaitlistEntry"("sessionId", "mode", "position");

CREATE INDEX IF NOT EXISTS "WaitlistEntry_holdExpiresAt_idx"
  ON "WaitlistEntry"("holdExpiresAt");

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
