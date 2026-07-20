-- Phase A4 — Matchmaker Agent (interest matching + drafted outreach)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) EventMembership.matchMeEnabled uses a SINGLE:
--      ADD COLUMN IF NOT EXISTS "matchMeEnabled" BOOLEAN NOT NULL DEFAULT true
--    Postgres fills every existing row with the constant DEFAULT (true) without a
--    separate UPDATE rewrite. All existing members end up matchMeEnabled = true.
--    (Nullable→backfill→NOT NULL is NOT used here — unnecessary for a new column
--    with a constant non-null default.)
-- 2) NO ADD VALUE on any existing enum. NotificationKind, AiMeterFeature,
--    AuditAction, EventMemberRole, ConversationType, etc. are UNTOUCHED.
--    No status enum on MatchSuggestion (none needed). If one were added later it
--    would be a NEW CREATE TYPE used only on that new table — not ADD VALUE.
--    Suggestion delivery reuses AGENT_ATTENDEE_TOUCH (DIGEST app-layer).
-- 3) New tables MatchProfileEmbedding + MatchSuggestion are additive only.
--    No other ALTER of existing NOT NULL columns. No other backfills.
-- 4) Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) EventMembership.matchMeEnabled
--    Single ADD COLUMN ... NOT NULL DEFAULT true.
--    Existing rows: all receive true from the constant DEFAULT.
--    Mute = app sets false (stops refreshes). Participation still requires
--    directoryOptIn both directions.
-- ---------------------------------------------------------------------------
ALTER TABLE "EventMembership"
  ADD COLUMN IF NOT EXISTS "matchMeEnabled" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2) MatchProfileEmbedding — cached gateway embeddings (recompute on profile edit)
--    Profile text is user-global; one row per user. Cosine shortlist is app-layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MatchProfileEmbedding" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "embedding" JSONB NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchProfileEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MatchProfileEmbedding_userId_key"
  ON "MatchProfileEmbedding"("userId");
CREATE INDEX IF NOT EXISTS "MatchProfileEmbedding_sourceHash_idx"
  ON "MatchProfileEmbedding"("sourceHash");

DO $$ BEGIN
  ALTER TABLE "MatchProfileEmbedding"
    ADD CONSTRAINT "MatchProfileEmbedding_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) MatchSuggestion — ranked "People you should meet" rows (DIGEST delivery)
--    batchKey: 'join' | 'week:YYYY-Www' for idempotent join + weekly refresh.
--    draftIntro is PRE-FILL only; never auto-sent. proposedSlots: 0–2 free slots.
--    No status enum — presence + batchKey is enough.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MatchSuggestion" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "forUserId" TEXT NOT NULL,
  "suggestedUserId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "whyLine" TEXT NOT NULL,
  "draftIntro" TEXT NOT NULL,
  "proposedSlots" JSONB,
  "batchKey" TEXT NOT NULL,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
  "usageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchSuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MatchSuggestion_rank_check" CHECK ("rank" >= 1 AND "rank" <= 5),
  CONSTRAINT "MatchSuggestion_not_self_check" CHECK ("forUserId" <> "suggestedUserId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MatchSuggestion_event_for_suggested_batch_key"
  ON "MatchSuggestion"("eventId", "forUserId", "suggestedUserId", "batchKey");
CREATE INDEX IF NOT EXISTS "MatchSuggestion_eventId_forUserId_batchKey_idx"
  ON "MatchSuggestion"("eventId", "forUserId", "batchKey");
CREATE INDEX IF NOT EXISTS "MatchSuggestion_forUserId_idx"
  ON "MatchSuggestion"("forUserId");
CREATE INDEX IF NOT EXISTS "MatchSuggestion_suggestedUserId_idx"
  ON "MatchSuggestion"("suggestedUserId");
CREATE INDEX IF NOT EXISTS "MatchSuggestion_eventId_createdAt_idx"
  ON "MatchSuggestion"("eventId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MatchSuggestion"
    ADD CONSTRAINT "MatchSuggestion_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MatchSuggestion"
    ADD CONSTRAINT "MatchSuggestion_forUserId_fkey"
    FOREIGN KEY ("forUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MatchSuggestion"
    ADD CONSTRAINT "MatchSuggestion_suggestedUserId_fkey"
    FOREIGN KEY ("suggestedUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
