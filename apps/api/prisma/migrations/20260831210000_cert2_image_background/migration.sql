-- CERT-2 — image-background certificate templates (DESIGN_PHASE_J §Certificates, J-C).
-- NOT APPLIED by the agent — CI and Render's build run migrate deploy.
--
-- MUST-CONFIRMS (read before deploy):
-- 1) Additive only. Two NEW enums and four NEW columns on "CertificateTemplate":
--    kind, backgroundImageUrl, nameBox, orientation. Nothing is dropped,
--    renamed, retyped, or made NOT NULL after the fact on an existing column.
-- 2) The two new enums are created with the duplicate_object guard, so a
--    partially-applied run is safe to repeat. They are NEW types, so this is
--    NOT an "ALTER TYPE ... ADD VALUE" and carries none of that hazard.
-- 3) kind, nameBox and orientation are NOT NULL WITH a DEFAULT, added in one
--    statement. On PostgreSQL 11+ that is metadata-only: the default is stored
--    in the catalog and existing rows are NOT rewritten, so there is no table
--    rewrite and no long lock even on a large table. No backfill needed.
-- 4) Defaults reproduce today's behaviour exactly: every existing template
--    becomes kind = 'TEXT', which is the built-in pdfkit layout it already
--    rendered, and the renderer branches on kind before reading any of the
--    other three. nameBox = '{}' normalizes to all-defaults in
--    @event-app/shared, and orientation is ignored by the TEXT branch. So
--    applying this migration changes no issued certificate and no UI on its own.
-- 5) backgroundImageUrl is nullable TEXT with no default — a data URL, same
--    storage shape as "Event"."logoUrl".
-- 6) Rollback = deploy the previous API commit. Columns and enums stay behind,
--    unread and harmless. Schema rollbacks are forward-fix only (RUNBOOK §4).
-- 7) Idempotent: IF NOT EXISTS on every ADD COLUMN, guarded CREATE TYPE.
-- Do NOT set ALLOW_DESTRUCTIVE_DB. Do NOT run against production.

DO $$ BEGIN
  CREATE TYPE "CertificateTemplateKind" AS ENUM ('TEXT', 'IMAGE_BACKGROUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CertificateOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "CertificateTemplate"
  ADD COLUMN IF NOT EXISTS "kind" "CertificateTemplateKind" NOT NULL DEFAULT 'TEXT';

ALTER TABLE "CertificateTemplate"
  ADD COLUMN IF NOT EXISTS "backgroundImageUrl" TEXT;

ALTER TABLE "CertificateTemplate"
  ADD COLUMN IF NOT EXISTS "nameBox" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "CertificateTemplate"
  ADD COLUMN IF NOT EXISTS "orientation" "CertificateOrientation" NOT NULL DEFAULT 'LANDSCAPE';
