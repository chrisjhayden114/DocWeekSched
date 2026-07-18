import {
  PLAN_BY_SKU,
  defaultSkuForTier,
  planDefinitionForTier,
  resolveEntitlement,
  type EntitlementKey,
  type LimitKey,
  type PlanSkuKey,
  type PlanTierId,
} from "@event-app/shared";
import type { FeatureKey } from "@event-app/shared";
import type { Organization, PlanTier, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../authorization";

export const GRACE_PERIOD_DAYS = 7;

export type OrgBillingSnapshot = {
  orgId: string;
  plan: PlanTierId;
  planSku: PlanSkuKey;
  subscriptionStatus: SubscriptionStatus;
  billingProvider: string;
  billingCustomerId: string | null;
  eventAllowance: number | null;
  eventsUsed: number;
  gracePeriodEndsAt: Date | null;
  /** True when PAST_DUE and grace window has ended. */
  readOnly: boolean;
  /** True when PAST_DUE but still inside grace. */
  inGracePeriod: boolean;
};

function asTier(plan: PlanTier | null | undefined): PlanTierId {
  if (plan === "PER_EVENT" || plan === "PRO" || plan === "ENTERPRISE" || plan === "INTERNAL" || plan === "FREE") {
    return plan;
  }
  return "FREE";
}

export function isOrgReadOnly(org: Pick<Organization, "subscriptionStatus" | "gracePeriodEndsAt" | "plan">): boolean {
  if (org.plan === "INTERNAL") return false;
  if (org.subscriptionStatus !== "PAST_DUE") return false;
  if (!org.gracePeriodEndsAt) return true;
  return org.gracePeriodEndsAt.getTime() <= Date.now();
}

export function isInGracePeriod(org: Pick<Organization, "subscriptionStatus" | "gracePeriodEndsAt" | "plan">): boolean {
  if (org.plan === "INTERNAL") return false;
  if (org.subscriptionStatus !== "PAST_DUE") return false;
  if (!org.gracePeriodEndsAt) return false;
  return org.gracePeriodEndsAt.getTime() > Date.now();
}

export async function loadOrgBilling(orgId: string): Promise<OrgBillingSnapshot> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const eventsUsed = await prisma.event.count({
    where: {
      organizationId: orgId,
      status: { in: ["DRAFT", "ACTIVE"] },
    },
  });
  const plan = asTier(org.plan);
  return {
    orgId,
    plan,
    planSku: defaultSkuForTier(plan),
    subscriptionStatus: org.subscriptionStatus,
    billingProvider: org.billingProvider,
    billingCustomerId: org.billingCustomerId,
    eventAllowance: org.eventAllowance,
    eventsUsed,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    readOnly: isOrgReadOnly(org),
    inGracePeriod: isInGracePeriod(org),
  };
}

/**
 * Plan entitlement check. INTERNAL always true.
 * Feature registry keys and plan flags share this helper.
 */
export async function can(orgId: string, feature: EntitlementKey | FeatureKey): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return false;
  if (org.plan === "INTERNAL") return true;
  const def = planDefinitionForTier(asTier(org.plan));
  return resolveEntitlement(def, feature as EntitlementKey);
}

/**
 * Numeric limits. NULL / missing allowance = unlimited (no cap).
 */
export async function limit(orgId: string, key: LimitKey): Promise<number | null> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return 0;
  if (org.plan === "INTERNAL") return null;
  if (key === "activeEvents") {
    // DB column is source of truth; NULL = unlimited
    if (org.eventAllowance === null) return null;
    return org.eventAllowance;
  }
  const def = planDefinitionForTier(asTier(org.plan));
  return def.limits[key];
}

export async function effectiveAttendeeCap(eventId: string): Promise<number | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { attendeeCap: true, organizationId: true, organization: { select: { plan: true } } },
  });
  if (!event) return 0;
  if (event.organization.plan === "INTERNAL") return null;
  const planCap = await limit(event.organizationId, "attendees");
  // Event row stores the tighter operational cap (purchase or free default).
  if (planCap == null) return event.attendeeCap > 0 ? event.attendeeCap : null;
  return Math.min(event.attendeeCap, planCap);
}

export type UpgradePayload = {
  code: "PLAN_LIMIT" | "BILLING_READ_ONLY" | "FEATURE_LOCKED";
  message: string;
  limitKey?: LimitKey;
  current?: number;
  max?: number | null;
  upgradeUrl: string;
  suggestedSkus: PlanSkuKey[];
};

export function upgradePayload(partial: Omit<UpgradePayload, "upgradeUrl" | "suggestedSkus"> & { suggestedSkus?: PlanSkuKey[] }): UpgradePayload {
  const base = (process.env.WEB_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    ...partial,
    upgradeUrl: `${base}/pricing`,
    suggestedSkus: partial.suggestedSkus || ["per_event_250", "pro_monthly", "pro_annual"],
  };
}

export async function assertOrgWritable(orgId: string): Promise<void> {
  const snap = await loadOrgBilling(orgId);
  if (snap.readOnly) {
    throw new HttpError(403, {
      error: "Billing is past due — this organization is read-only until payment is updated.",
      upgrade: upgradePayload({
        code: "BILLING_READ_ONLY",
        message: "Update your payment method to restore editing and invites.",
        suggestedSkus: ["pro_monthly", "pro_annual"],
      }),
    });
  }
}

export async function assertCanCreateEvent(orgId: string): Promise<void> {
  await assertOrgWritable(orgId);
  const max = await limit(orgId, "activeEvents");
  if (max == null) return;
  const used = await prisma.event.count({
    where: { organizationId: orgId, status: { in: ["DRAFT", "ACTIVE"] } },
  });
  if (used >= max) {
    throw new HttpError(402, {
      error: `Your plan allows ${max} active event${max === 1 ? "" : "s"}. Upgrade to create another.`,
      upgrade: upgradePayload({
        code: "PLAN_LIMIT",
        message: `Active event limit reached (${used}/${max}).`,
        limitKey: "activeEvents",
        current: used,
        max,
        suggestedSkus: ["pro_monthly", "pro_annual", "per_event_250"],
      }),
    });
  }
}

export async function assertCanAddAttendee(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) throw new HttpError(404, { error: "Event not found" });
  await assertOrgWritable(event.organizationId);

  const cap = await effectiveAttendeeCap(eventId);
  if (cap == null) return;

  const current = await prisma.eventMembership.count({
    where: { eventId, deletedAt: null },
  });
  if (current >= cap) {
    throw new HttpError(402, {
      error: `This event is at its attendee limit (${cap}). Upgrade your plan to invite more people.`,
      upgrade: upgradePayload({
        code: "PLAN_LIMIT",
        message: `Attendee limit reached (${current}/${cap}).`,
        limitKey: "attendees",
        current,
        max: cap,
        suggestedSkus: ["per_event_500", "per_event_1000", "pro_monthly"],
      }),
    });
  }
}

/** Apply SKU entitlements onto an organization (webhooks + tests). */
export async function applyPlanSkuToOrg(
  orgId: string,
  sku: PlanSkuKey,
  extra?: {
    billingCustomerId?: string | null;
    billingSubscriptionId?: string | null;
    subscriptionStatus?: SubscriptionStatus;
    clearGrace?: boolean;
  },
): Promise<void> {
  const def = PLAN_BY_SKU[sku];
  if (!def) throw new Error(`Unknown plan sku: ${sku}`);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      plan: def.tier,
      eventAllowance: def.limits.activeEvents,
      subscriptionStatus: extra?.subscriptionStatus ?? (def.tier === "FREE" ? "NONE" : "ACTIVE"),
      billingCustomerId: extra?.billingCustomerId === undefined ? undefined : extra.billingCustomerId,
      billingSubscriptionId: extra?.billingSubscriptionId === undefined ? undefined : extra.billingSubscriptionId,
      gracePeriodEndsAt: extra?.clearGrace ? null : undefined,
      entitlementsUpdatedAt: new Date(),
      ...(def.tier === "FREE"
        ? { billingSubscriptionId: null }
        : {}),
    },
  });
}

export async function markPaymentFailed(orgId: string, now = new Date()): Promise<Date> {
  const ends = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionStatus: "PAST_DUE",
      gracePeriodEndsAt: ends,
      entitlementsUpdatedAt: now,
    },
  });
  return ends;
}

export async function markSubscriptionCanceled(orgId: string): Promise<void> {
  await applyPlanSkuToOrg(orgId, "free", {
    subscriptionStatus: "CANCELED",
    billingSubscriptionId: null,
    clearGrace: true,
  });
}

export { PLAN_BY_SKU, planDefinitionForTier };
