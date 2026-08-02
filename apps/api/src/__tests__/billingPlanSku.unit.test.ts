/**
 * Chunk E5.1 — persist the purchased SKU.
 *
 * Bug: applyPlanSkuToOrg stored only the tier, so the billing snapshot
 * reconstructed planSku via defaultSkuForTier(plan) — pro_monthly purchases
 * rendered as "Pro · Annual". These tests drive the real webhook transitions
 * (applySubscriptionActive / applyOrderPaid) through processVerifiedWebhook
 * against an in-memory prisma mock (same approach as billingStripe.unit.test:
 * the DB suite is guarded and must not run with ALLOW_DESTRUCTIVE_DB) and
 * assert the snapshot reports the SKU that was actually purchased.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const orgs = new Map<string, Record<string, unknown>>();
  const webhookKeys = new Set<string>();
  const eventPurchases: Array<Record<string, unknown>> = [];
  return { orgs, webhookKeys, eventPurchases };
});

vi.mock("../lib/db", () => ({
  prisma: {
    billingWebhookEvent: {
      create: async ({ data }: { data: { provider: string; externalEventId: string } }) => {
        const key = `${data.provider}:${data.externalEventId}`;
        if (state.webhookKeys.has(key)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        state.webhookKeys.add(key);
        return data;
      },
      updateMany: async () => ({ count: 1 }),
    },
    organization: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.orgs.get(where.id) || { id: where.id };
        // Prisma ignores undefined values in update data; mirror that.
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) row[key] = value;
        }
        state.orgs.set(where.id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => state.orgs.get(where.id) || null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = state.orgs.get(where.id);
        if (!row) throw new Error("Not found");
        return row;
      },
    },
    eventPurchase: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.eventPurchases.push(data);
        return data;
      },
    },
    event: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      }),
      count: async () => 0,
    },
  },
}));

import { defaultSkuForTier } from "@event-app/shared";
import { loadOrgBilling } from "../lib/billing/entitlements";
import { processVerifiedWebhook } from "../lib/billing/webhooks";
import {
  MockBillingProvider,
  mockOrderCreatedPayload,
  mockSubscriptionPayload,
  signMockWebhook,
} from "../lib/billing/mock";

function deliver(body: Record<string, unknown>) {
  const { raw, signature } = signMockWebhook(body, "test-webhook-secret");
  const verified = new MockBillingProvider("test-webhook-secret").verifyWebhook(raw, signature);
  return processVerifiedWebhook(verified);
}

beforeEach(() => {
  state.orgs.clear();
  state.webhookKeys.clear();
  state.eventPurchases.length = 0;
});

describe("purchased SKU persistence (E5.1)", () => {
  it("applySubscriptionActive with pro_monthly → snapshot.planSku === 'pro_monthly'", async () => {
    state.orgs.set("org_mo", { id: "org_mo", plan: "FREE", planSku: null });

    const result = await deliver(
      mockSubscriptionPayload("subscription_created", {
        orgId: "org_mo",
        planKey: "pro_monthly",
        externalEventId: "evt_sku_mo",
      }),
    );
    expect(result.applied).toBe("subscription:pro_monthly");

    expect(state.orgs.get("org_mo")!.planSku).toBe("pro_monthly");
    const snap = await loadOrgBilling("org_mo");
    expect(snap.plan).toBe("PRO");
    expect(snap.planSku).toBe("pro_monthly");
  });

  it("applySubscriptionActive with pro_annual → snapshot.planSku === 'pro_annual'", async () => {
    state.orgs.set("org_yr", { id: "org_yr", plan: "FREE", planSku: null });

    const result = await deliver(
      mockSubscriptionPayload("subscription_created", {
        orgId: "org_yr",
        planKey: "pro_annual",
        externalEventId: "evt_sku_yr",
      }),
    );
    expect(result.applied).toBe("subscription:pro_annual");

    expect(state.orgs.get("org_yr")!.planSku).toBe("pro_annual");
    const snap = await loadOrgBilling("org_yr");
    expect(snap.planSku).toBe("pro_annual");
  });

  it("applyOrderPaid with per_event_500 → snapshot.planSku === 'per_event_500'", async () => {
    state.orgs.set("org_pe", { id: "org_pe", plan: "FREE", planSku: null });

    const result = await deliver(
      mockOrderCreatedPayload({
        orgId: "org_pe",
        planKey: "per_event_500",
        eventIdExternal: "evt_sku_pe",
      }),
    );
    expect(result.applied).toBe("order:per_event_500");

    expect(state.orgs.get("org_pe")!.planSku).toBe("per_event_500");
    const snap = await loadOrgBilling("org_pe");
    expect(snap.plan).toBe("PER_EVENT");
    expect(snap.planSku).toBe("per_event_500");
  });

  it("NULL planSku column falls back to defaultSkuForTier (grandfathered orgs)", async () => {
    // Pre-E5.1 PRO org: column never populated.
    state.orgs.set("org_old", { id: "org_old", plan: "PRO", planSku: null, subscriptionStatus: "ACTIVE" });

    const snap = await loadOrgBilling("org_old");
    expect(snap.planSku).toBe(defaultSkuForTier("PRO"));
    expect(snap.planSku).toBe("pro_annual");
  });
});
