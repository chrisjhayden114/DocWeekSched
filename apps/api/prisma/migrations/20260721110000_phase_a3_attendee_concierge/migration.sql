-- Phase A3 — Attendee Concierge (FAQ + persistent chat + confirm-gated pending actions)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) NO ADD VALUE on any existing enum. ConversationType, NotificationKind,
--    AiMeterFeature, EventMemberRole, AuditAction, etc. are UNTOUCHED.
-- 2) ConciergeMessageRole and ConciergePendingActionStatus are NEW CREATE TYPEs
--    used ONLY on tables created in this migration — fine in one transaction.
-- 3) Additive only: no ALTER of existing NOT NULL columns, no row backfills.
-- 4) ConciergePendingAction.userId and eventId are FK-constrained. App layer
--    confirms by matching these columns to the SERVER SESSION (never model output).
--    Propose mints the row; execute only on authenticated confirm.
--
-- Idempotent: IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.
-- Reversible + mid-failure recovery: see README.md.
-- Do NOT run against production / ep-square-lab.

-- ---------------------------------------------------------------------------
-- 1) New enums (safe to use on new tables in this migration)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ConciergeMessageRole" AS ENUM (
    'USER',
    'ASSISTANT',
    'SYSTEM'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConciergePendingActionStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) EventFaq (organizer-editable grounding corpus)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventFaq" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventFaq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EventFaq_eventId_idx" ON "EventFaq"("eventId");
CREATE INDEX IF NOT EXISTS "EventFaq_eventId_sortOrder_idx" ON "EventFaq"("eventId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "EventFaq"
    ADD CONSTRAINT "EventFaq_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) ConciergeConversation (one thread per attendee per event)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ConciergeConversation" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciergeConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConciergeConversation_eventId_userId_key"
  ON "ConciergeConversation"("eventId", "userId");
CREATE INDEX IF NOT EXISTS "ConciergeConversation_userId_idx"
  ON "ConciergeConversation"("userId");
CREATE INDEX IF NOT EXISTS "ConciergeConversation_eventId_updatedAt_idx"
  ON "ConciergeConversation"("eventId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "ConciergeConversation"
    ADD CONSTRAINT "ConciergeConversation_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConciergeConversation"
    ADD CONSTRAINT "ConciergeConversation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) ConciergeMessage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ConciergeMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "ConciergeMessageRole" NOT NULL,
  "body" TEXT NOT NULL,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "toolProposals" JSONB,
  "pendingActionIds" JSONB,
  "usageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciergeMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConciergeMessage_conversationId_createdAt_idx"
  ON "ConciergeMessage"("conversationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ConciergeMessage"
    ADD CONSTRAINT "ConciergeMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ConciergeConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) ConciergePendingAction
--     Propose mints this row; confirm executes only when session userId/eventId
--     match these FK columns. Model output never supplies userId/eventId.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ConciergePendingAction" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "tool" TEXT NOT NULL,
  "args" JSONB NOT NULL DEFAULT '{}',
  "preview" JSONB NOT NULL DEFAULT '{}',
  "status" "ConciergePendingActionStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciergePendingAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConciergePendingAction_userId_status_idx"
  ON "ConciergePendingAction"("userId", "status");
CREATE INDEX IF NOT EXISTS "ConciergePendingAction_eventId_status_idx"
  ON "ConciergePendingAction"("eventId", "status");
CREATE INDEX IF NOT EXISTS "ConciergePendingAction_expiresAt_idx"
  ON "ConciergePendingAction"("expiresAt");
CREATE INDEX IF NOT EXISTS "ConciergePendingAction_conversationId_idx"
  ON "ConciergePendingAction"("conversationId");

DO $$ BEGIN
  ALTER TABLE "ConciergePendingAction"
    ADD CONSTRAINT "ConciergePendingAction_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConciergePendingAction"
    ADD CONSTRAINT "ConciergePendingAction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConciergePendingAction"
    ADD CONSTRAINT "ConciergePendingAction_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ConciergeConversation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
