import { BillingProvider as BillingProviderEnum, Prisma, PurchaseStatus } from "@prisma/client";
import type { PlanSkuKey } from "@event-app/shared";
import { PLAN_BY_SKU } from "@event-app/shared";
import { prisma } from "../db";
import {
  applyPlanSkuToOrg,
  markPaymentFailed,
  markSubscriptionCanceled,
} from "./entitlements";
import type { VerifiedWebhook } from "./types";

function customData(payload: Record<string, unknown>): Record<string, unknown> {
  const meta = (payload.meta as Record<string, unknown> | undefined) || {};
  const custom = (meta.custom_data as Record<string, unknown> | undefined) || {};
  return custom;
}

function asPlanKey(raw: unknown): PlanSkuKey | null {
  if (typeof raw !== "string") return null;
  if (raw in PLAN_BY_SKU) return raw as PlanSkuKey;
  return null;
}

function asString(raw: unknown): string | null {
  return typeof raw === "string" && raw ? raw : null;
}

function providerEnumFor(verified: VerifiedWebhook): BillingProviderEnum {
  if (verified.provider === "NONE") return BillingProviderEnum.NONE;
  if (verified.provider === "STRIPE") return BillingProviderEnum.STRIPE;
  return BillingProviderEnum.LEMON_SQUEEZY;
}

/**
 * Apply a verified webhook. Idempotent via BillingWebhookEvent unique (provider, externalEventId).
 * Returns { duplicate: true } when already processed.
 */
export async function processVerifiedWebhook(
  verified: VerifiedWebhook,
): Promise<{ duplicate: boolean; applied: string | null }> {
  const providerEnum = providerEnumFor(verified);

  try {
    await prisma.billingWebhookEvent.create({
      data: {
        provider: providerEnum,
        externalEventId: verified.externalEventId,
        type: verified.type,
        payload: verified.payload as unknown as Prisma.InputJsonValue,
        processedAt: null,
      },
    });
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : "";
    if (code === "P2002") {
      return { duplicate: true, applied: null };
    }
    throw err;
  }

  const applied = await dispatchWebhook(verified);

  await prisma.billingWebhookEvent.updateMany({
    where: {
      provider: providerEnum,
      externalEventId: verified.externalEventId,
      processedAt: null,
    },
    data: { processedAt: new Date() },
  });

  return { duplicate: false, applied };
}

async function dispatchWebhook(verified: VerifiedWebhook): Promise<string | null> {
  if (verified.provider === "STRIPE") return dispatchStripeWebhook(verified);
  return dispatchLemonSqueezyWebhook(verified);
}

// ---------------------------------------------------------------------------
// Shared entitlement transitions — every provider's events funnel into these
// so Stripe and Lemon Squeezy drive identical org/plan state changes.
// ---------------------------------------------------------------------------

/** One-time order paid (LS order_created/order_paid, Stripe payment-mode checkout completed). */
async function applyOrderPaid(opts: {
  orgId: string;
  planKey: PlanSkuKey;
  eventId: string | null;
  customerId: string | null;
  checkoutId: string | null;
  providerEnum: BillingProviderEnum;
}): Promise<string> {
  const { orgId, planKey, eventId, customerId } = opts;
  const def = PLAN_BY_SKU[planKey];
  await applyPlanSkuToOrg(orgId, planKey, {
    billingCustomerId: customerId,
    subscriptionStatus: "ACTIVE",
    clearGrace: true,
  });
  if (def.tier === "PER_EVENT") {
    await prisma.eventPurchase.create({
      data: {
        organizationId: orgId,
        eventId,
        plan: "PER_EVENT",
        planKey,
        amountCents: def.displayPriceCents ?? 0,
        currency: def.currency,
        status: PurchaseStatus.PAID,
        billingCheckoutId: opts.checkoutId,
        billingOrderId: opts.checkoutId,
        attendeeCap: def.limits.attendees ?? 250,
        paidAt: new Date(),
      },
    });
    if (eventId && def.limits.attendees != null) {
      await prisma.event.update({
        where: { id: eventId },
        data: { attendeeCap: def.limits.attendees, plan: "PER_EVENT" },
      });
    }
    // One-time purchase shouldn't flip org to PER_EVENT forever if they were PRO —
    // Spec: PER-EVENT is one-time for an event. Keep org on FREE unless already PRO/INTERNAL.
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (org && (org.plan === "FREE" || org.plan === "PER_EVENT" || !org.plan)) {
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          plan: "PER_EVENT",
          eventAllowance: 1,
          entitlementsUpdatedAt: new Date(),
        },
      });
    }
  }
  if (customerId) {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        billingProvider: opts.providerEnum,
        billingCustomerId: customerId,
      },
    });
  }
  return `order:${planKey}`;
}

/** Subscription created/renewed/resumed — plan active, grace cleared. */
async function applySubscriptionActive(opts: {
  orgId: string;
  planKey: PlanSkuKey;
  customerId: string | null;
  subscriptionId: string | null;
  providerEnum: BillingProviderEnum;
}): Promise<string> {
  await applyPlanSkuToOrg(opts.orgId, opts.planKey, {
    billingCustomerId: opts.customerId,
    billingSubscriptionId: opts.subscriptionId,
    subscriptionStatus: "ACTIVE",
    clearGrace: true,
  });
  await prisma.organization.update({
    where: { id: opts.orgId },
    data: { billingProvider: opts.providerEnum, gracePeriodEndsAt: null },
  });
  return `subscription:${opts.planKey}`;
}

// ---------------------------------------------------------------------------
// Lemon Squeezy events
// ---------------------------------------------------------------------------

async function dispatchLemonSqueezyWebhook(verified: VerifiedWebhook): Promise<string | null> {
  const custom = customData(verified.payload);
  const orgId = typeof custom.org_id === "string" ? custom.org_id : null;
  const planKey = asPlanKey(custom.plan_key);
  const eventId = typeof custom.event_id === "string" && custom.event_id ? custom.event_id : null;
  const data = (verified.payload.data as Record<string, unknown> | undefined) || {};
  const attrs = (data.attributes as Record<string, unknown> | undefined) || {};
  const customerId = attrs.customer_id != null ? String(attrs.customer_id) : null;
  const resourceId = data.id != null ? String(data.id) : null;

  const type = verified.type;

  if (type === "order_created" || type === "order_paid") {
    if (!orgId || !planKey) return null;
    return applyOrderPaid({
      orgId,
      planKey,
      eventId,
      customerId,
      checkoutId: resourceId,
      providerEnum: BillingProviderEnum.LEMON_SQUEEZY,
    });
  }

  if (
    type === "subscription_created" ||
    type === "subscription_updated" ||
    type === "subscription_payment_success" ||
    type === "subscription_resumed"
  ) {
    if (!orgId || !planKey) return null;
    return applySubscriptionActive({
      orgId,
      planKey,
      customerId,
      subscriptionId: resourceId,
      providerEnum: BillingProviderEnum.LEMON_SQUEEZY,
    });
  }

  if (type === "subscription_cancelled" || type === "subscription_expired") {
    if (!orgId) return null;
    await markSubscriptionCanceled(orgId);
    return "subscription:canceled";
  }

  if (type === "subscription_payment_failed") {
    if (!orgId) return null;
    await markPaymentFailed(orgId);
    return "subscription:past_due";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stripe events — payload is the raw Stripe event ({ id, type, data.object }).
// createCheckout puts orgId/planKey/eventId into session, subscription, and
// payment-intent metadata so every event below can recover them.
// ---------------------------------------------------------------------------

function stripeObject(payload: Record<string, unknown>): Record<string, unknown> {
  const data = (payload.data as Record<string, unknown> | undefined) || {};
  return (data.object as Record<string, unknown> | undefined) || {};
}

/** Metadata lives on the object itself; invoices carry it under subscription_details (older API) or parent.subscription_details (newer). */
function stripeMetadata(object: Record<string, unknown>): Record<string, unknown> {
  const direct = object.metadata as Record<string, unknown> | undefined;
  if (direct && Object.keys(direct).length > 0) return direct;
  const subDetails = object.subscription_details as Record<string, unknown> | undefined;
  const subMeta = subDetails?.metadata as Record<string, unknown> | undefined;
  if (subMeta && Object.keys(subMeta).length > 0) return subMeta;
  const parent = object.parent as Record<string, unknown> | undefined;
  const parentSub = parent?.subscription_details as Record<string, unknown> | undefined;
  const parentMeta = parentSub?.metadata as Record<string, unknown> | undefined;
  if (parentMeta && Object.keys(parentMeta).length > 0) return parentMeta;
  const lines = object.lines as { data?: Array<Record<string, unknown>> } | undefined;
  const lineMeta = lines?.data?.[0]?.metadata as Record<string, unknown> | undefined;
  return lineMeta || {};
}

async function dispatchStripeWebhook(verified: VerifiedWebhook): Promise<string | null> {
  const object = stripeObject(verified.payload);
  const meta = stripeMetadata(object);
  const orgId = asString(meta.orgId);
  const planKey = asPlanKey(meta.planKey);
  const eventId = asString(meta.eventId);
  const customerId = asString(object.customer);
  const type = verified.type;

  if (type === "checkout.session.completed") {
    if (!orgId || !planKey) return null;
    if (object.mode === "subscription") {
      return applySubscriptionActive({
        orgId,
        planKey,
        customerId,
        subscriptionId: asString(object.subscription),
        providerEnum: BillingProviderEnum.STRIPE,
      });
    }
    return applyOrderPaid({
      orgId,
      planKey,
      eventId,
      customerId,
      checkoutId: asString(object.id),
      providerEnum: BillingProviderEnum.STRIPE,
    });
  }

  if (type === "customer.subscription.updated") {
    if (!orgId) return null;
    const status = asString(object.status) || "";
    if (status === "canceled" || status === "incomplete_expired") {
      await markSubscriptionCanceled(orgId);
      return "subscription:canceled";
    }
    if (status === "past_due" || status === "unpaid") {
      await markPaymentFailed(orgId);
      return "subscription:past_due";
    }
    if (!planKey) return null;
    return applySubscriptionActive({
      orgId,
      planKey,
      customerId,
      subscriptionId: asString(object.id),
      providerEnum: BillingProviderEnum.STRIPE,
    });
  }

  if (type === "customer.subscription.deleted") {
    if (!orgId) return null;
    await markSubscriptionCanceled(orgId);
    return "subscription:canceled";
  }

  if (type === "invoice.payment_succeeded") {
    if (!orgId || !planKey) return null;
    return applySubscriptionActive({
      orgId,
      planKey,
      customerId,
      subscriptionId: asString(object.subscription),
      providerEnum: BillingProviderEnum.STRIPE,
    });
  }

  if (type === "invoice.payment_failed") {
    if (!orgId) return null;
    await markPaymentFailed(orgId);
    return "subscription:past_due";
  }

  return null;
}
