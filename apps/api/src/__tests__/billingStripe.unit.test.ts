/**
 * Chunk E5 — Stripe Managed Payments provider.
 *
 * Covers: Stripe-Signature verification (valid / tampered / stale), the
 * planKey→price/mode checkout mapping, and the webhook→entitlement mapping for
 * checkout.session.completed and customer.subscription.deleted. The entitlement
 * tests run processVerifiedWebhook against an in-memory prisma mock so they
 * exercise the real dispatch/transition code without a database (the DB suite
 * is guarded and must not run with ALLOW_DESTRUCTIVE_DB).
 */

import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const orgs = new Map<string, Record<string, unknown>>();
  const webhookKeys = new Set<string>();
  const eventPurchases: Array<Record<string, unknown>> = [];
  const eventUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  return { orgs, webhookKeys, eventPurchases, eventUpdates };
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
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.eventUpdates.push({ where, data });
        return { id: where.id, ...data };
      },
    },
  },
}));

import {
  StripeBillingProvider,
  stripeModeForPlan,
} from "../lib/billing/stripe";
import { processVerifiedWebhook } from "../lib/billing/webhooks";

const WEBHOOK_SECRET = "whsec_test_secret";

const TEST_PRICE_IDS = {
  per_event_250: "price_pe250",
  per_event_500: "price_pe500",
  per_event_1000: "price_pe1000",
  pro_monthly: "price_pro_mo",
  pro_annual: "price_pro_yr",
} as const;

function makeProvider() {
  return new StripeBillingProvider({
    secretKey: "sk_test_123",
    webhookSecret: WEBHOOK_SECRET,
    priceIds: { ...TEST_PRICE_IDS },
  });
}

function signStripe(raw: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

function stripeEvent(id: string, type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id, type, data: { object } });
}

beforeEach(() => {
  state.orgs.clear();
  state.webhookKeys.clear();
  state.eventPurchases.length = 0;
  state.eventUpdates.length = 0;
});

describe("Stripe webhook signature verification", () => {
  it("verifies a correctly signed payload and parses id/type", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_sig_ok", "checkout.session.completed", { id: "cs_1" });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    expect(verified.provider).toBe("STRIPE");
    expect(verified.externalEventId).toBe("evt_sig_ok");
    expect(verified.type).toBe("checkout.session.completed");
  });

  it("accepts Buffer bodies (raw-body route)", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_buf", "invoice.payment_succeeded", { id: "in_1" });
    const verified = provider.verifyWebhook(Buffer.from(raw, "utf8"), signStripe(raw));
    expect(verified.externalEventId).toBe("evt_buf");
  });

  it("rejects a tampered body", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_tamper", "checkout.session.completed", { id: "cs_1" });
    const header = signStripe(raw);
    const tampered = raw.replace("cs_1", "cs_2");
    expect(() => provider.verifyWebhook(tampered, header)).toThrow(/signature/i);
  });

  it("rejects a signature from the wrong secret", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_wrong_secret", "checkout.session.completed", { id: "cs_1" });
    expect(() => provider.verifyWebhook(raw, signStripe(raw, "whsec_other"))).toThrow(/signature/i);
  });

  it("rejects stale timestamps (>5 minutes)", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_stale", "checkout.session.completed", { id: "cs_1" });
    const stale = Math.floor(Date.now() / 1000) - 600;
    expect(() => provider.verifyWebhook(raw, signStripe(raw, WEBHOOK_SECRET, stale))).toThrow(/tolerance/i);
  });

  it("rejects missing or malformed headers", () => {
    const provider = makeProvider();
    const raw = stripeEvent("evt_nohdr", "checkout.session.completed", { id: "cs_1" });
    expect(() => provider.verifyWebhook(raw, undefined)).toThrow(/Stripe-Signature/i);
    expect(() => provider.verifyWebhook(raw, "v1=deadbeef")).toThrow(/malformed/i);
  });
});

describe("planKey → price/mode mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one-time SKUs are payment mode, Pro SKUs are subscription mode", () => {
    expect(stripeModeForPlan("per_event_250")).toBe("payment");
    expect(stripeModeForPlan("per_event_500")).toBe("payment");
    expect(stripeModeForPlan("per_event_1000")).toBe("payment");
    expect(stripeModeForPlan("pro_monthly")).toBe("subscription");
    expect(stripeModeForPlan("pro_annual")).toBe("subscription");
  });

  it("isConfigured requires the secret key and all five price ids", () => {
    expect(makeProvider().isConfigured()).toBe(true);
    const missingPrice = new StripeBillingProvider({
      secretKey: "sk_test_123",
      webhookSecret: WEBHOOK_SECRET,
      priceIds: { ...TEST_PRICE_IDS, pro_annual: undefined },
    });
    expect(missingPrice.isConfigured()).toBe(false);
    const missingKey = new StripeBillingProvider({
      secretKey: "",
      webhookSecret: WEBHOOK_SECRET,
      priceIds: { ...TEST_PRICE_IDS },
    });
    expect(missingKey.isConfigured()).toBe(false);
  });

  it("createCheckout posts the mapped price, mode, managed_payments flag, and metadata for every SKU", async () => {
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(new URLSearchParams(String(init?.body || "")));
        return {
          ok: true,
          json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }),
          text: async () => "",
        };
      }),
    );

    const provider = makeProvider();
    const skus = ["per_event_250", "per_event_500", "per_event_1000", "pro_monthly", "pro_annual"] as const;
    for (const planKey of skus) {
      const result = await provider.createCheckout({
        orgId: "org_1",
        planKey,
        eventId: planKey.startsWith("per_event") ? "evt_db_1" : undefined,
        customerEmail: "buyer@example.com",
        successUrl: "https://readyhall.com/organizer/billing?ok=1",
        cancelUrl: "https://readyhall.com/organizer/billing?cancelled=1",
      });
      expect(result.url).toContain("checkout.stripe.com");
      expect(result.checkoutId).toBe("cs_test_1");
    }

    expect(bodies).toHaveLength(skus.length);
    for (let i = 0; i < skus.length; i++) {
      const planKey = skus[i];
      const body = bodies[i];
      const expectedMode = stripeModeForPlan(planKey);
      expect(body.get("mode")).toBe(expectedMode);
      expect(body.get("line_items[0][price]")).toBe(TEST_PRICE_IDS[planKey]);
      expect(body.get("managed_payments[enabled]")).toBe("true");
      expect(body.get("customer_email")).toBe("buyer@example.com");
      expect(body.get("metadata[orgId]")).toBe("org_1");
      expect(body.get("metadata[planKey]")).toBe(planKey);
      // Metadata must also land on the subscription / payment intent so
      // webhooks on those objects can recover org + plan.
      const nested = expectedMode === "subscription" ? "subscription_data" : "payment_intent_data";
      expect(body.get(`${nested}[metadata][orgId]`)).toBe("org_1");
      expect(body.get(`${nested}[metadata][planKey]`)).toBe(planKey);
      if (expectedMode === "payment") {
        expect(body.get("invoice_creation[enabled]")).toBe("true");
      } else {
        expect(body.has("invoice_creation[enabled]")).toBe(false);
      }
    }
  });

  it("payment-mode checkout enables invoice_creation; subscription-mode does not", async () => {
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(new URLSearchParams(String(init?.body || "")));
        return {
          ok: true,
          json: async () => ({ id: "cs_test_inv", url: "https://checkout.stripe.com/c/pay/cs_test_inv" }),
          text: async () => "",
        };
      }),
    );

    const provider = makeProvider();
    await provider.createCheckout({
      orgId: "org_1",
      planKey: "per_event_250",
      eventId: "evt_db_1",
      successUrl: "https://readyhall.com/organizer/billing?ok=1",
      cancelUrl: "https://readyhall.com/organizer/billing?cancelled=1",
    });
    await provider.createCheckout({
      orgId: "org_1",
      planKey: "pro_monthly",
      successUrl: "https://readyhall.com/organizer/billing?ok=1",
      cancelUrl: "https://readyhall.com/organizer/billing?cancelled=1",
    });

    expect(bodies[0].get("mode")).toBe("payment");
    expect(bodies[0].get("invoice_creation[enabled]")).toBe("true");
    expect(bodies[1].get("mode")).toBe("subscription");
    expect(bodies[1].has("invoice_creation[enabled]")).toBe(false);
  });
});

describe("Stripe webhook → entitlement mapping", () => {
  it("checkout.session.completed (subscription mode) flips the org to PRO, mirroring the LS subscription path", async () => {
    const provider = makeProvider();
    state.orgs.set("org_1", { id: "org_1", plan: "FREE" });

    const raw = stripeEvent("evt_co_sub_1", "checkout.session.completed", {
      id: "cs_sub_1",
      object: "checkout.session",
      mode: "subscription",
      customer: "cus_1",
      subscription: "sub_1",
      metadata: { orgId: "org_1", planKey: "pro_monthly", eventId: "" },
    });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    const result = await processVerifiedWebhook(verified);

    expect(result.duplicate).toBe(false);
    expect(result.applied).toBe("subscription:pro_monthly");
    const org = state.orgs.get("org_1")!;
    expect(org.plan).toBe("PRO");
    expect(org.subscriptionStatus).toBe("ACTIVE");
    expect(org.billingCustomerId).toBe("cus_1");
    expect(org.billingSubscriptionId).toBe("sub_1");
    expect(org.billingProvider).toBe("STRIPE");
    expect(org.gracePeriodEndsAt).toBeNull();
  });

  it("checkout.session.completed (payment mode) records a per-event purchase and caps the event, mirroring the LS order path", async () => {
    const provider = makeProvider();
    state.orgs.set("org_2", { id: "org_2", plan: "FREE" });

    const raw = stripeEvent("evt_co_pay_1", "checkout.session.completed", {
      id: "cs_pay_1",
      object: "checkout.session",
      mode: "payment",
      customer: "cus_2",
      metadata: { orgId: "org_2", planKey: "per_event_500", eventId: "evt_db_1" },
    });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    const result = await processVerifiedWebhook(verified);

    expect(result.applied).toBe("order:per_event_500");
    expect(state.eventPurchases).toHaveLength(1);
    expect(state.eventPurchases[0]).toMatchObject({
      organizationId: "org_2",
      eventId: "evt_db_1",
      plan: "PER_EVENT",
      planKey: "per_event_500",
      status: "PAID",
      billingCheckoutId: "cs_pay_1",
      attendeeCap: 500,
    });
    expect(state.eventUpdates).toHaveLength(1);
    expect(state.eventUpdates[0].where.id).toBe("evt_db_1");
    expect(state.eventUpdates[0].data).toMatchObject({ attendeeCap: 500, plan: "PER_EVENT" });

    const org = state.orgs.get("org_2")!;
    expect(org.plan).toBe("PER_EVENT");
    expect(org.eventAllowance).toBe(1);
    expect(org.billingProvider).toBe("STRIPE");
    expect(org.billingCustomerId).toBe("cus_2");
  });

  it("customer.subscription.deleted reverts the org to Free, mirroring the LS cancellation path", async () => {
    const provider = makeProvider();
    state.orgs.set("org_3", {
      id: "org_3",
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      billingSubscriptionId: "sub_3",
    });

    const raw = stripeEvent("evt_sub_del_1", "customer.subscription.deleted", {
      id: "sub_3",
      object: "subscription",
      status: "canceled",
      customer: "cus_3",
      metadata: { orgId: "org_3", planKey: "pro_monthly" },
    });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    const result = await processVerifiedWebhook(verified);

    expect(result.applied).toBe("subscription:canceled");
    const org = state.orgs.get("org_3")!;
    expect(org.plan).toBe("FREE");
    expect(org.subscriptionStatus).toBe("CANCELED");
    expect(org.billingSubscriptionId).toBeNull();
  });

  it("invoice.payment_failed marks the org past-due with a grace window", async () => {
    const provider = makeProvider();
    state.orgs.set("org_4", { id: "org_4", plan: "PRO", subscriptionStatus: "ACTIVE" });

    const raw = stripeEvent("evt_inv_fail_1", "invoice.payment_failed", {
      id: "in_1",
      object: "invoice",
      customer: "cus_4",
      subscription_details: { metadata: { orgId: "org_4", planKey: "pro_monthly" } },
    });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    const result = await processVerifiedWebhook(verified);

    expect(result.applied).toBe("subscription:past_due");
    const org = state.orgs.get("org_4")!;
    expect(org.subscriptionStatus).toBe("PAST_DUE");
    expect(org.gracePeriodEndsAt).toBeInstanceOf(Date);
    expect((org.gracePeriodEndsAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("is idempotent on Stripe event id (duplicate replay is a no-op)", async () => {
    const provider = makeProvider();
    state.orgs.set("org_5", { id: "org_5", plan: "FREE" });

    const raw = stripeEvent("evt_dup_1", "checkout.session.completed", {
      id: "cs_dup_1",
      object: "checkout.session",
      mode: "subscription",
      customer: "cus_5",
      subscription: "sub_5",
      metadata: { orgId: "org_5", planKey: "pro_annual", eventId: "" },
    });
    const verified = provider.verifyWebhook(raw, signStripe(raw));
    const first = await processVerifiedWebhook(verified);
    expect(first.duplicate).toBe(false);
    const second = await processVerifiedWebhook(verified);
    expect(second.duplicate).toBe(true);
    expect(second.applied).toBeNull();
  });
});
