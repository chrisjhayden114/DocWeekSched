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

/**
 * Apply a verified webhook. Idempotent via BillingWebhookEvent unique (provider, externalEventId).
 * Returns { duplicate: true } when already processed.
 */
export async function processVerifiedWebhook(
  verified: VerifiedWebhook,
): Promise<{ duplicate: boolean; applied: string | null }> {
  const providerEnum =
    verified.provider === "NONE" ? BillingProviderEnum.NONE : BillingProviderEnum.LEMON_SQUEEZY;

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
    const def = PLAN_BY_SKU[planKey];
    await applyPlanSkuToOrg(orgId, planKey, {
      billingCustomerId: customerId,
      subscriptionStatus: def.interval === "one_time" || !def.interval ? "ACTIVE" : "ACTIVE",
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
          billingCheckoutId: resourceId,
          billingOrderId: resourceId,
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
    if (orgId && customerId) {
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          billingProvider: BillingProviderEnum.LEMON_SQUEEZY,
          billingCustomerId: customerId,
        },
      });
    }
    return `order:${planKey}`;
  }

  if (
    type === "subscription_created" ||
    type === "subscription_updated" ||
    type === "subscription_payment_success" ||
    type === "subscription_resumed"
  ) {
    if (!orgId || !planKey) return null;
    await applyPlanSkuToOrg(orgId, planKey, {
      billingCustomerId: customerId,
      billingSubscriptionId: resourceId,
      subscriptionStatus: "ACTIVE",
      clearGrace: true,
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { billingProvider: BillingProviderEnum.LEMON_SQUEEZY, gracePeriodEndsAt: null },
    });
    return `subscription:${planKey}`;
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
