-- W-2 ROSTER-IMPORT — add participants without emailing them.
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. ONE nullable column on EventMembership. No column is
--    dropped, renamed, retyped or made NOT NULL. No index. No data is written
--    and there is NO backfill.
-- 2) NO enum changes. The roster's invite status is derived in application
--    code (lib/inviteStatus.ts), not stored, so no enum needed a new member.
-- 3) The column starts NULL on every existing row, which reads as "this seat
--    came in through an invite or self-registration" — i.e. every existing
--    member derives exactly the status they derive today. Only the new
--    POST /attendees/import writes a value.
-- 4) Rollback = stop writing the column (nullable, unread by older code).
--    Forward-fix only (RUNBOOK §4).
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

ALTER TABLE "EventMembership"
  ADD COLUMN IF NOT EXISTS "addedWithoutInviteAt" TIMESTAMP(3);
