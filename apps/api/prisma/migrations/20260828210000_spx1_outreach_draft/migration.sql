-- SPX-1 — AiMeterFeature.OUTREACH_DRAFT (ADD VALUE isolation)
-- NOT APPLIED by the agent — CI and Render's build run migrate deploy.
--
-- MUST-CONFIRMS (read before deploy):
-- 1) This file is ONLY ALTER TYPE ... ADD VALUE IF NOT EXISTS 'OUTREACH_DRAFT'.
--    Zero other statements. The new label is never compared or inserted here.
-- 2) Postgres forbids using a freshly-added enum value in the same transaction.
-- 3) Additive / forward-only. Do NOT set ALLOW_DESTRUCTIVE_DB.
-- Do NOT run against production.

ALTER TYPE "AiMeterFeature" ADD VALUE IF NOT EXISTS 'OUTREACH_DRAFT';
