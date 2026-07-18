-- Phase 2.5 soft-delete for event roster (NOT APPLIED — review before migrate deploy)
-- Soft-remove participants for 30 days; active roster queries filter deletedAt IS NULL.

ALTER TABLE "EventMembership" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EventMembership_eventId_deletedAt_idx" ON "EventMembership"("eventId", "deletedAt");
