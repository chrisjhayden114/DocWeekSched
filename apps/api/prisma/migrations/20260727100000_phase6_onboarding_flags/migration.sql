-- Phase 6 Chunk C — first-run onboarding persistence flags
-- DO NOT APPLY until founder review. Additive only (nullable columns).
-- EventMembership.checkInCode is untouched — must keep @default(cuid()) in schema.prisma.
-- Checklist content remains on EventSeries.setupChecklist (JSON); no new checklist table.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingDismissedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sampleEventOfferedAt" TIMESTAMP(3);
