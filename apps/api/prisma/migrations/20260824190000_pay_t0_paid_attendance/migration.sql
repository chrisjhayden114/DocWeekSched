-- PAY-T0 — "collect payment your way" (DESIGN_PHASE_J §Paid attendance).
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. Three nullable columns on Event, two on EventMembership.
--    No column is dropped, renamed, retyped or made NOT NULL. No index. No
--    data is written and there is NO backfill.
-- 2) NO enum changes. paymentStatus is a VARCHAR validated in application code
--    (packages/shared paidAttendance.ts: UNPAID | PO_ON_FILE | PAID | WAIVED |
--    REFUNDED), deliberately not a DB enum — the same doctrine as the roster's
--    derived invite status. A future PAY-T1 webhook flips the same column.
-- 3) Every column starts NULL on every existing row. On Event, NULL means "no
--    registration fee published" — which is what every existing event means
--    today. On EventMembership, NULL means "this event never tracked a fee for
--    this person", which is distinct from UNPAID ("we expect money and haven't
--    had it"). Nothing reads these columns unless the per-event
--    `paid_attendance` feature is on, and it is off by default, so applying
--    this migration changes no UI anywhere.
-- 4) This stores payment *state and instructions* only. No card data, no
--    tokens, no account identifiers: attendee money never touches this
--    platform, so there is nothing here to leak. paymentUrl is an
--    organizer-published http(s) link (validated server-side) and
--    paymentReference is an organizer-typed PO/check number.
-- 5) Rollback = turn the feature off and stop writing the columns (nullable,
--    unread by older code). Forward-fix only (RUNBOOK §4).
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "paymentPriceText" VARCHAR(120);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "paymentUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT;

ALTER TABLE "EventMembership" ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(20);
ALTER TABLE "EventMembership" ADD COLUMN IF NOT EXISTS "paymentReference" VARCHAR(80);
