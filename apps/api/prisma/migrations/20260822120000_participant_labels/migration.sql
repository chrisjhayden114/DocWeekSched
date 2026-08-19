-- PART-1 — organizer-defined per-event participant labels.
-- Additive only. User.participantType is left in place (unread by new UI).
--
-- Decision: deleting a label from Event.participantLabelsJson NULLs
-- EventMembership.participantLabel on rows that held the removed string.
-- Implemented in the API write path (not a DB trigger).
--
-- MUST-CONFIRMS:
-- 1) Additive only. Two nullable columns. No drops, renames, retypes, or
--    NOT NULL without a default. No data is written.
-- 2) NO enum changes. User.participantType is untouched.
-- 3) Rollback = stop writing the columns (unread by older code).
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "participantLabelsJson" TEXT;
ALTER TABLE "EventMembership" ADD COLUMN IF NOT EXISTS "participantLabel" VARCHAR(40);
