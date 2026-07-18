import { Router } from "express";
import { z } from "zod";
import {
  PRICE_LOCK,
  formatDisplayPrice,
  publicPricingPlans,
  PLAN_BY_SKU,
  type PlanSkuKey,
} from "@event-app/shared";
import { asyncHandler, HttpError, requireOrgRole } from "../lib/authorization";
import { OrgRole } from "@prisma/client";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import {
  getBillingProvider,
  loadOrgBilling,
  can,
  limit,
  processVerifiedWebhook,
} from "../lib/billing";

export const billingRouter = Router();

const checkoutSchema = z.object({
  organizationId: z.string().min(1),
  planKey: z.enum([
    "per_event_250",
    "per_event_500",
    "per_event_1000",
    "pro_monthly",
    "pro_annual",
  ]),
  eventId: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/** Public pricing catalog — same numbers checkout charges. */
billingRouter.get(
  "/pricing",
  asyncHandler(async (_req, res) => {
    const plans = publicPricingPlans().map((p) => ({
      sku: p.sku,
      tier: p.tier,
      name: p.name,
      plainDescription: p.plainDescription,
      displayPriceCents: p.displayPriceCents,
      displayPrice: formatDisplayPrice(p.displayPriceCents, p.currency, p.interval),
      currency: p.currency,
      interval: p.interval,
      limits: p.limits,
      contactOnly: Boolean(p.contactOnly),
      taxNote: "Prices shown are the catalog amounts; Lemon Squeezy (merchant of record) adds applicable sales tax/VAT at checkout.",
    }));
    return res.json({
      plans,
      priceLock: PRICE_LOCK,
      merchantOfRecord: "Lemon Squeezy",
    });
  }),
);

billingRouter.get(
  "/summary",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!orgId) return res.status(400).json({ error: "organizationId required" });
    await requireOrgRole(req.user!.id, orgId, OrgRole.STAFF);

    const snap = await loadOrgBilling(orgId);
    const def = PLAN_BY_SKU[snap.planSku];
    const attendeeLimit = await limit(orgId, "attendees");
    const aiLimit = await limit(orgId, "aiIngestPerEvent");
    const aiConciergeLimit = await limit(orgId, "aiConciergePerEvent");
    const hideBadge = await can(orgId, "hide_powered_by_badge");

    const provider = getBillingProvider();
    let invoices: Awaited<ReturnType<NonNullable<typeof provider.listInvoices>>> = [];
    if (snap.billingCustomerId && provider.listInvoices) {
      invoices = await provider.listInvoices(snap.billingCustomerId).catch(() => []);
    }

    return res.json({
      ...snap,
      planName: def.name,
      planDescription: def.plainDescription,
      displayPrice: formatDisplayPrice(def.displayPriceCents, def.currency, def.interval),
      limits: {
        activeEvents: snap.eventAllowance,
        attendees: attendeeLimit,
        aiIngestPerEvent: aiLimit,
        aiConciergePerEvent: aiConciergeLimit,
      },
      usage: {
        activeEvents: snap.eventsUsed,
      },
      showPoweredByBadge: !hideBadge && snap.plan === "FREE",
      billingConfigured: provider.isConfigured(),
      invoices,
      priceLock: PRICE_LOCK,
    });
  }),
);

billingRouter.post(
  "/checkout",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await requireOrgRole(req.user!.id, parsed.data.organizationId, OrgRole.ADMIN);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const provider = getBillingProvider();
    if (!provider.isConfigured() && provider.name === "none") {
      throw new HttpError(503, { error: "Billing is not configured yet. Use sandbox keys or BILLING_PROVIDER=mock." });
    }

    const base = env.webBaseUrl.replace(/\/$/, "");
    const result = await provider.createCheckout({
      orgId: parsed.data.organizationId,
      planKey: parsed.data.planKey as PlanSkuKey,
      eventId: parsed.data.eventId,
      customerEmail: user?.email,
      successUrl: parsed.data.successUrl || `${base}/organizer/billing?ok=1`,
      cancelUrl: parsed.data.cancelUrl || `${base}/organizer/billing?cancelled=1`,
    });

    await prisma.eventPurchase.create({
      data: {
        organizationId: parsed.data.organizationId,
        eventId: parsed.data.eventId || null,
        plan: PLAN_BY_SKU[parsed.data.planKey as PlanSkuKey].tier,
        planKey: parsed.data.planKey,
        amountCents: PLAN_BY_SKU[parsed.data.planKey as PlanSkuKey].displayPriceCents ?? 0,
        currency: "usd",
        status: "PENDING",
        billingCheckoutId: result.checkoutId,
        attendeeCap: PLAN_BY_SKU[parsed.data.planKey as PlanSkuKey].limits.attendees ?? 50,
      },
    }).catch(() => undefined);

    return res.json(result);
  }),
);

billingRouter.post(
  "/portal",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orgId = typeof req.body?.organizationId === "string" ? req.body.organizationId : "";
    if (!orgId) return res.status(400).json({ error: "organizationId required" });
    await requireOrgRole(req.user!.id, orgId, OrgRole.ADMIN);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (!org.billingCustomerId) {
      throw new HttpError(400, { error: "No billing customer on file yet — complete a checkout first." });
    }
    const provider = getBillingProvider();
    const base = env.webBaseUrl.replace(/\/$/, "");
    const result = await provider.createCustomerPortal({
      orgId,
      customerId: org.billingCustomerId,
      returnUrl: `${base}/organizer/billing`,
    });
    return res.json(result);
  }),
);

/**
 * Lemon Squeezy (and mock) webhook. Mounted with express.raw in index.ts.
 * Signature: HMAC-SHA256 hex of raw body in X-Signature.
 */
export async function handleBillingWebhook(req: AuthedRequest, res: import("express").Response) {
  const provider = getBillingProvider();
  const signature = req.header("x-signature") || req.header("X-Signature") || undefined;
  const raw = (req as { rawBody?: Buffer }).rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})));
  let verified;
  try {
    verified = provider.verifyWebhook(raw, signature);
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : "Invalid signature" });
  }
  const result = await processVerifiedWebhook(verified);
  return res.json({ ok: true, ...result });
}
