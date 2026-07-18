# Phase 3 — Billing entitlements (Lemon Squeezy MoR)

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## MoR choice

**Lemon Squeezy** — solo-founder fit, hosted checkout + portal, tax/VAT as MoR, mockable webhooks. App code uses a `BillingProvider` interface so Stripe/Paddle can be a later config swap.

---

## What this migration does

### PlanTier rewrite (three columns — all required before DROP TYPE)

Old: `STARTER | PRO | ORG_ANNUAL`  
New: `FREE | PER_EVENT | PRO | ENTERPRISE | INTERNAL`

| Column | Nullability | USING map |
|--------|-------------|-----------|
| **`Organization.plan`** | nullable | STARTER→FREE, ORG_ANNUAL→PRO, PRO→PRO, NULL→NULL |
| **`EventPurchase.plan`** | NOT NULL | same; defensive ELSE→FREE |
| **`Event.plan`** | nullable | same as Organization |

Each column: `DROP DEFAULT` → `ALTER COLUMN ... TYPE "PlanTier_new" USING (CASE …)` → then `DROP TYPE "PlanTier"` → rename `PlanTier_new` → `PlanTier`.  
Organization then gets `DEFAULT 'FREE'`.

### BillingProvider (new)

`NONE | LEMON_SQUEEZY | PADDLE | STRIPE | INTERNAL`

### Organization

- Add: `billingProvider`, `billingCustomerId`, `billingSubscriptionId`, `billingSubscriptionItemId`, `gracePeriodEndsAt`, `entitlementsUpdatedAt`
- Copy any `stripeCustomerId` / `stripeSubscriptionId` → billing\* then **drop** Stripe columns
- **`eventAllowance`**: made **nullable**. **`NULL` = unlimited** (future `limit()` treats NULL as no cap). Documented choice — not a magic number.
- Non-default orgs with `plan IS NULL` → `FREE` + `eventAllowance = 1`
- FREE orgs with 0/NULL allowance → `1` (except Default slug during grandfather path)

### Grandfather (required)

Default Organization (`slug = 'default'`) whose **OWNER** is `cjhayden114@gmail.com`:

- `plan = INTERNAL`
- `billingProvider = INTERNAL`
- `subscriptionStatus = ACTIVE`
- `eventAllowance = NULL` (unlimited)
- clears grace period

OWNER-guarded `WHERE` — will not promote a hijacked default slug without that owner email.

### Event.attendeeCap

- New-row default: **50** (FREE)
- Existing events on INTERNAL / Default-org (same OWNER guard): backfilled to **100000** so the live DocWeek roster is never blocked

### EventPurchase

- Add `billingCheckoutId`, `billingOrderId`, `planKey`
- Copy Stripe session/intent ids if any; drop Stripe columns

### EventSeries price lock

- `priceLockPlanKey`, `priceLockAmountCents`, `priceLockCurrency` (default `usd`), `priceLockInterval`, `priceLockedAt`

### BillingWebhookEvent

- Idempotency: `@@unique([provider, externalEventId])`

---

## Partial-failure recovery (enum rewrite)

Postgres enum rewrites can leave messy state if interrupted mid-transaction (or if a step fails after renaming types).

**If `migrate deploy` fails partway:**

1. Do **not** run `prisma migrate resolve`
2. **Reset the dev Neon branch from its parent** (Neon console → reset/restore branch)
3. Re-run `npx prisma migrate deploy` on a clean branch tip

This migration is designed for a single clean apply on the already-migrated Phase 2.6 schema.

---

## Reverse (documented down steps — manual)

Only on disposable/dev data. Approximate reverse:

```sql
-- Webhook log
DROP TABLE IF EXISTS "BillingWebhookEvent";

-- Series price lock
ALTER TABLE "EventSeries"
  DROP COLUMN IF EXISTS "priceLockPlanKey",
  DROP COLUMN IF EXISTS "priceLockAmountCents",
  DROP COLUMN IF EXISTS "priceLockCurrency",
  DROP COLUMN IF EXISTS "priceLockInterval",
  DROP COLUMN IF EXISTS "priceLockedAt";

-- Event cap default back to 150 (optional)
ALTER TABLE "Event" ALTER COLUMN "attendeeCap" SET DEFAULT 150;

-- EventPurchase: re-add Stripe-shaped cols, copy back, drop billing*
ALTER TABLE "EventPurchase"
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT;
UPDATE "EventPurchase" SET
  "stripeCheckoutSessionId" = "billingCheckoutId",
  "stripePaymentIntentId" = "billingOrderId";
ALTER TABLE "EventPurchase"
  DROP COLUMN IF EXISTS "billingCheckoutId",
  DROP COLUMN IF EXISTS "billingOrderId",
  DROP COLUMN IF EXISTS "planKey";

-- Organization: re-add Stripe cols, copy, drop billing* + grace fields
-- (Then reverse PlanTier with PlanTier_old: FREE→STARTER, PER_EVENT→STARTER,
--  ENTERPRISE→PRO, INTERNAL→PRO, PRO→PRO — converting ALL THREE plan columns
--  before DROP TYPE "PlanTier".)
-- DROP TYPE "BillingProvider";
```

Full reverse of the enum is the same three-column discipline as the forward migration.

---

## After you apply successfully

Tell the agent migrate succeeded. Next (app code, small commits):

1. `packages/shared` plan definitions + price-lock copy  
2. `lib/billing` Lemon Squeezy provider + mock webhooks  
3. `can` / `limit` wired into `featureEnabled` / `planAllowsFeature`  
4. Enforce invite/event-create limits + upgrade prompts  
5. `/pricing` + in-app Billing  
6. Tests (webhook entitlements, FREE→PRO, 7-day grace → read-only)

### Env you’ll need for sandbox later

```
BILLING_PROVIDER=lemonsqueezy
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
# variant IDs per SKU (per_event_250/500/1000, pro_monthly, pro_annual)
BILLING_SUCCESS_URL=
BILLING_CANCEL_URL=
```

Webhook URL: `https://<api-host>/billing/webhooks/lemonsqueezy`
