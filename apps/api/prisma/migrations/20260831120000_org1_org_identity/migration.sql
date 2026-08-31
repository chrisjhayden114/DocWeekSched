-- ORG-1 — organization identity columns (DESIGN_PHASE_J §Org entity, J-C).
-- NOT APPLIED by the agent — CI and Render's build run migrate deploy.
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. Four NEW nullable TEXT columns on "Organization":
--    websiteUrl, supportEmail, logoUrl, description. No DEFAULT, no NOT NULL,
--    so the ADD COLUMN is metadata-only — no table rewrite, no lock beyond a
--    brief ACCESS EXCLUSIVE for the catalog update, no backfill.
-- 2) NO new enum, NO ADD VALUE on any existing enum, NO new table, NO index.
--    NO drop, rename, retype, or NOT NULL on any existing column. Existing
--    readers (which select Organization columns explicitly) cannot break.
-- 3) Every existing org reads NULL on all four, which is exactly the state the
--    product had before this migration: no website link, no contact mailto,
--    no fallback logo, no description. Applying this changes no UI on its own.
-- 4) Rollback = deploy the previous API commit. The columns stay behind,
--    unread and harmless. Schema rollbacks are forward-fix only (RUNBOOK §4).
-- 5) Idempotent: ADD COLUMN IF NOT EXISTS on all four.
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "description" TEXT;
