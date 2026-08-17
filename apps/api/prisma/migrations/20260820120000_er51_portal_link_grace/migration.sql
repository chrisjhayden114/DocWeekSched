-- ER5.1 — portal link grace on remint (one previous token stays valid).
-- NOT APPLIED by the agent — review this FULL file, then on the test/dev Neon
-- branch only:
--   cd apps/api && npx prisma migrate deploy   (against DIRECT_DATABASE_URL)
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. TWO nullable columns on ReadinessPortalAccess and ONE
--    unique index. No column is dropped, renamed, retyped or made NOT NULL;
--    no data is written. Existing readers and writers cannot break — code that
--    never mentions the new columns keeps behaving exactly as it does today.
-- 2) NO enum changes anywhere. No new table. No backfill.
-- 3) Both columns start NULL on every existing row, which reads as "no earlier
--    link is in grace". Grace only ever begins at the NEXT remint, so applying
--    this migration cannot revive a link that is dead today.
-- 4) previousTokenHash is UNIQUE like tokenHash. Postgres treats NULLs as
--    distinct, so the many rows with no grace token do not collide.
-- 5) Revocation stays absolute: revoke nulls both columns in application code
--    (lib/readiness/portal.ts), and a revoked row's current token is never
--    carried into the grace slot on remint.
-- 6) Rollback = stop writing the columns (they are nullable and unread by
--    older code). Forward-fix only (RUNBOOK §4).
-- Do NOT run against production.

-- ---------------------------------------------------------------------------
-- 1) The grace slot: the immediately-prior token and ITS original expiry.
-- ---------------------------------------------------------------------------
ALTER TABLE "ReadinessPortalAccess"
  ADD COLUMN IF NOT EXISTS "previousTokenHash" TEXT;

ALTER TABLE "ReadinessPortalAccess"
  ADD COLUMN IF NOT EXISTS "previousExpiresAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 2) One row per grace token, and the index the token lookup reads.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ReadinessPortalAccess_previousTokenHash_key"
  ON "ReadinessPortalAccess"("previousTokenHash");
