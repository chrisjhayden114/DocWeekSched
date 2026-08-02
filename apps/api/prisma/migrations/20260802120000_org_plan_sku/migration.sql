-- Chunk E5.1: persist the purchased SKU (label bug — Pro Monthly rendered as
-- "Pro · Annual" because the snapshot reconstructed the SKU from the tier via
-- defaultSkuForTier, which returns pro_annual for PRO).
--
-- Additive + nullable, expand-then-deploy. No backfill: NULL falls back to the
-- old defaultSkuForTier(plan) derivation, so existing orgs are unaffected.
ALTER TABLE "Organization" ADD COLUMN "planSku" TEXT;
