-- HARDEN-2 — session invalidation on password reset/change and account-deletion request.
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. ONE integer column on User, NOT NULL DEFAULT 0. No column
--    is dropped, renamed, retyped or made NOT NULL without a default; no data
--    is written. Existing readers and writers cannot break — code that never
--    mentions the new column keeps behaving exactly as it does today.
-- 2) NO enum changes. No new table. No backfill.
-- 3) Existing rows receive 0. Older JWTs without a sessionVersion claim are
--    treated as version 0, so sessions survive deploy and are invalidated only
--    on the next password event.
-- 4) Rollback = stop writing the column (unread by older code). Forward-fix
--    only (RUNBOOK §4).
-- Do NOT run against production.
-- EventMembership.checkInCode is untouched.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
