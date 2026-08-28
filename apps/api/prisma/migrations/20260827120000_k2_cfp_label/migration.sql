-- K-2 — organizer-chosen display name for the CFP (DESIGN_PHASE_K D4).
-- Additive only. Null means the shared helper shows "Call for Presentations".
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. One nullable VARCHAR(60) on Event. No drop, rename,
--    retype, or NOT NULL. No index. No data is written and there is NO
--    backfill — every existing row stays NULL, which is the current default.
-- 2) NO enum changes.
-- 3) Applying this migration changes no UI until an organizer types a custom
--    label; older code ignores the unread column.
-- 4) Rollback = stop writing the column (nullable, unread by older code).
--    Forward-fix only (RUNBOOK §4).
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "cfpLabel" VARCHAR(60);
