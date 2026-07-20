-- Phase 3 — Billing entitlements (Lemon Squeezy MoR–ready, provider-agnostic columns)
-- NOT APPLIED by the agent — review, then on the DEV Neon branch only:
--   cd apps/api && npx prisma migrate deploy
--
-- CRITICAL: PlanTier is rewritten. Three columns use it:
--   Organization.plan (nullable)
--   EventPurchase.plan (NOT NULL)
--   Event.plan (nullable)
-- All three are converted with explicit USING maps BEFORE DROP TYPE "PlanTier".
--
-- Unlimited semantics: Organization.eventAllowance NULL = no cap (limit() treats NULL as unlimited).
-- INTERNAL grandfather: Default Organization (owner cjhayden114@gmail.com) → plan INTERNAL, unlimited.
--
-- If this migration fails PARTWAY: do NOT prisma migrate resolve.
-- Reset the dev Neon branch from its parent and re-run deploy (see README.md).

-- ---------------------------------------------------------------------------
-- 1) BillingProvider enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "BillingProvider" AS ENUM (
    'NONE',
    'LEMON_SQUEEZY',
    'PADDLE',
    'STRIPE',
    'INTERNAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) PlanTier rewrite — only when old labels (STARTER / ORG_ANNUAL) still exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PlanTier'
      AND e.enumlabel = 'STARTER'
  ) THEN
    CREATE TYPE "PlanTier_new" AS ENUM (
      'FREE',
      'PER_EVENT',
      'PRO',
      'ENTERPRISE',
      'INTERNAL'
    );

    -- --- Organization.plan (nullable) ---
    ALTER TABLE "Organization" ALTER COLUMN "plan" DROP DEFAULT;
    ALTER TABLE "Organization"
      ALTER COLUMN "plan" TYPE "PlanTier_new"
      USING (
        CASE "plan"::text
          WHEN 'STARTER' THEN 'FREE'::"PlanTier_new"
          WHEN 'ORG_ANNUAL' THEN 'PRO'::"PlanTier_new"
          WHEN 'PRO' THEN 'PRO'::"PlanTier_new"
          ELSE NULL
        END
      );

    -- --- EventPurchase.plan (NOT NULL) ---
    ALTER TABLE "EventPurchase" ALTER COLUMN "plan" DROP DEFAULT;
    ALTER TABLE "EventPurchase"
      ALTER COLUMN "plan" TYPE "PlanTier_new"
      USING (
        CASE "plan"::text
          WHEN 'STARTER' THEN 'FREE'::"PlanTier_new"
          WHEN 'ORG_ANNUAL' THEN 'PRO'::"PlanTier_new"
          WHEN 'PRO' THEN 'PRO'::"PlanTier_new"
          -- Defensive: unexpected / impossible NULL on NOT NULL column
          ELSE 'FREE'::"PlanTier_new"
        END
      );

    -- --- Event.plan (nullable) ---
    ALTER TABLE "Event" ALTER COLUMN "plan" DROP DEFAULT;
    ALTER TABLE "Event"
      ALTER COLUMN "plan" TYPE "PlanTier_new"
      USING (
        CASE "plan"::text
          WHEN 'STARTER' THEN 'FREE'::"PlanTier_new"
          WHEN 'ORG_ANNUAL' THEN 'PRO'::"PlanTier_new"
          WHEN 'PRO' THEN 'PRO'::"PlanTier_new"
          ELSE NULL
        END
      );

    -- Safe only after all three columns no longer reference old PlanTier
    DROP TYPE "PlanTier";
    ALTER TYPE "PlanTier_new" RENAME TO "PlanTier";
  END IF;
END $$;

-- Defaults after rewrite (Organization only; Event.plan stays nullable with no default)
ALTER TABLE "Organization"
  ALTER COLUMN "plan" SET DEFAULT 'FREE'::"PlanTier";

-- ---------------------------------------------------------------------------
-- 3) Organization — provider-agnostic billing columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "billingProvider" "BillingProvider" NOT NULL DEFAULT 'NONE';

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "billingCustomerId" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "billingSubscriptionId" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "billingSubscriptionItemId" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt" TIMESTAMP(3);

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "entitlementsUpdatedAt" TIMESTAMP(3);

-- Copy any legacy Stripe ids (expected empty in prod today)
UPDATE "Organization"
SET "billingCustomerId" = COALESCE("billingCustomerId", "stripeCustomerId")
WHERE "stripeCustomerId" IS NOT NULL
  AND ("billingCustomerId" IS NULL OR "billingCustomerId" = "stripeCustomerId");

UPDATE "Organization"
SET "billingSubscriptionId" = COALESCE("billingSubscriptionId", "stripeSubscriptionId")
WHERE "stripeSubscriptionId" IS NOT NULL
  AND ("billingSubscriptionId" IS NULL OR "billingSubscriptionId" = "stripeSubscriptionId");

UPDATE "Organization"
SET "billingProvider" = 'STRIPE'::"BillingProvider"
WHERE ("stripeCustomerId" IS NOT NULL OR "stripeSubscriptionId" IS NOT NULL)
  AND "billingProvider" = 'NONE'::"BillingProvider";

DROP INDEX IF EXISTS "Organization_stripeCustomerId_key";
DROP INDEX IF EXISTS "Organization_stripeSubscriptionId_key";

ALTER TABLE "Organization" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "stripeSubscriptionId";

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_billingCustomerId_key"
  ON "Organization"("billingCustomerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_billingSubscriptionId_key"
  ON "Organization"("billingSubscriptionId");

-- eventAllowance: NULL = unlimited (document + future limit() helper)
-- Was NOT NULL DEFAULT 0; widen to nullable and clear the 0 default.
ALTER TABLE "Organization" ALTER COLUMN "eventAllowance" DROP DEFAULT;
ALTER TABLE "Organization" ALTER COLUMN "eventAllowance" DROP NOT NULL;

-- Orgs with no plan yet → FREE + 1 active-event allowance (not the Default org)
UPDATE "Organization"
SET
  "plan" = 'FREE'::"PlanTier",
  "eventAllowance" = 1,
  "billingProvider" = CASE
    WHEN "billingProvider" = 'NONE'::"BillingProvider" THEN 'NONE'::"BillingProvider"
    ELSE "billingProvider"
  END
WHERE "plan" IS NULL
  AND "slug" <> 'default';

-- Orgs already on a paid-mapped plan with allowance 0: leave as-is for app to reconcile;
-- FREE-mapped (was STARTER→FREE) get allowance 1 if still 0/NULL and not INTERNAL.
UPDATE "Organization"
SET "eventAllowance" = 1
WHERE "plan" = 'FREE'::"PlanTier"
  AND ("eventAllowance" IS NULL OR "eventAllowance" = 0)
  AND "slug" <> 'default';

-- ---------------------------------------------------------------------------
-- 4) Grandfather Default Organization → INTERNAL / unlimited
--     OWNER-guarded: owner email must be cjhayden114@gmail.com
-- ---------------------------------------------------------------------------
UPDATE "Organization" o
SET
  "plan" = 'INTERNAL'::"PlanTier",
  "billingProvider" = 'INTERNAL'::"BillingProvider",
  "subscriptionStatus" = 'ACTIVE'::"SubscriptionStatus",
  "eventAllowance" = NULL,
  "gracePeriodEndsAt" = NULL,
  "entitlementsUpdatedAt" = CURRENT_TIMESTAMP
WHERE o."slug" = 'default'
  AND EXISTS (
    SELECT 1
    FROM "OrgMembership" om
    JOIN "User" u ON u."id" = om."userId"
    WHERE om."organizationId" = o."id"
      AND om."role" = 'OWNER'::"OrgRole"
      AND u."email" = 'cjhayden114@gmail.com'
  );

-- ---------------------------------------------------------------------------
-- 5) EventPurchase — MoR checkout ids + planKey
-- ---------------------------------------------------------------------------
ALTER TABLE "EventPurchase"
  ADD COLUMN IF NOT EXISTS "billingCheckoutId" TEXT;

ALTER TABLE "EventPurchase"
  ADD COLUMN IF NOT EXISTS "billingOrderId" TEXT;

ALTER TABLE "EventPurchase"
  ADD COLUMN IF NOT EXISTS "planKey" TEXT;

UPDATE "EventPurchase"
SET "billingCheckoutId" = COALESCE("billingCheckoutId", "stripeCheckoutSessionId")
WHERE "stripeCheckoutSessionId" IS NOT NULL;

UPDATE "EventPurchase"
SET "billingOrderId" = COALESCE("billingOrderId", "stripePaymentIntentId")
WHERE "stripePaymentIntentId" IS NOT NULL;

UPDATE "EventPurchase"
SET "planKey" = COALESCE(
  "planKey",
  CASE "plan"::text
    WHEN 'PER_EVENT' THEN 'per_event'
    WHEN 'PRO' THEN 'pro'
    WHEN 'FREE' THEN 'free'
    WHEN 'ENTERPRISE' THEN 'enterprise'
    WHEN 'INTERNAL' THEN 'internal'
    ELSE 'free'
  END
)
WHERE "planKey" IS NULL;

DROP INDEX IF EXISTS "EventPurchase_stripeCheckoutSessionId_key";

ALTER TABLE "EventPurchase" DROP COLUMN IF EXISTS "stripeCheckoutSessionId";
ALTER TABLE "EventPurchase" DROP COLUMN IF EXISTS "stripePaymentIntentId";

CREATE UNIQUE INDEX IF NOT EXISTS "EventPurchase_billingCheckoutId_key"
  ON "EventPurchase"("billingCheckoutId");

-- ---------------------------------------------------------------------------
-- 6) Event.attendeeCap — new default 50; INTERNAL/Default org events backfilled high
-- ---------------------------------------------------------------------------
ALTER TABLE "Event" ALTER COLUMN "attendeeCap" DROP DEFAULT;
ALTER TABLE "Event" ALTER COLUMN "attendeeCap" SET DEFAULT 50;

UPDATE "Event" e
SET "attendeeCap" = 100000
FROM "Organization" o
WHERE e."organizationId" = o."id"
  AND (
    o."plan" = 'INTERNAL'::"PlanTier"
    OR (
      o."slug" = 'default'
      AND EXISTS (
        SELECT 1
        FROM "OrgMembership" om
        JOIN "User" u ON u."id" = om."userId"
        WHERE om."organizationId" = o."id"
          AND om."role" = 'OWNER'::"OrgRole"
          AND u."email" = 'cjhayden114@gmail.com'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 7) EventSeries — recurring-event price lock snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE "EventSeries"
  ADD COLUMN IF NOT EXISTS "priceLockPlanKey" TEXT;

ALTER TABLE "EventSeries"
  ADD COLUMN IF NOT EXISTS "priceLockAmountCents" INTEGER;

ALTER TABLE "EventSeries"
  ADD COLUMN IF NOT EXISTS "priceLockCurrency" TEXT NOT NULL DEFAULT 'usd';

ALTER TABLE "EventSeries"
  ADD COLUMN IF NOT EXISTS "priceLockInterval" TEXT;

ALTER TABLE "EventSeries"
  ADD COLUMN IF NOT EXISTS "priceLockedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 8) BillingWebhookEvent — idempotency (provider + externalEventId)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingWebhookEvent_provider_externalEventId_key"
  ON "BillingWebhookEvent"("provider", "externalEventId");

CREATE INDEX IF NOT EXISTS "BillingWebhookEvent_createdAt_idx"
  ON "BillingWebhookEvent"("createdAt");
