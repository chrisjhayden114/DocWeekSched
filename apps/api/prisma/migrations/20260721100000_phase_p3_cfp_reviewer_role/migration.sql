-- Phase P3 migration 1/2 — EventMemberRole.REVIEWER (ADD VALUE isolation)
-- NOT APPLIED by the agent — review this FULL file, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- MUST-CONFIRMS (read before deploy):
-- 1) This file contains ONLY:
--      ALTER TYPE "EventMemberRole" ADD VALUE IF NOT EXISTS 'REVIEWER';
--    Nothing else — no CREATE TABLE, no INSERT, no UPDATE, no CASE/WHEN,
--    no comparison to 'REVIEWER' as an enum literal.
-- 2) Postgres forbids using a freshly-added enum value in the same transaction.
--    Role assignment (EventMembership.role = REVIEWER) is APP-LAYER post-migrate.
--    Migration 2 also NEVER inserts/compares 'REVIEWER'.
-- 3) Enum ADD VALUE is forward-only in Postgres (not cheaply reversible).
--
-- Mid-failure: reset the DEV Neon branch from its parent — do not hand-patch.
-- Do NOT run against production / ep-square-lab.

ALTER TYPE "EventMemberRole" ADD VALUE IF NOT EXISTS 'REVIEWER';
