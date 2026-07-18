import { describe, expect, it, beforeEach } from "vitest";
import {
  PLAN_BY_SKU,
  PRICE_LOCK,
  formatDisplayPrice,
  planDefinitionForTier,
  resolveEntitlement,
} from "@event-app/shared";
import {
  MockBillingProvider,
  signMockWebhook,
  mockOrderCreatedPayload,
  mockSubscriptionPayload,
  resetBillingProviderForTests,
  GRACE_PERIOD_DAYS,
  isOrgReadOnly,
  isInGracePeriod,
} from "../lib/billing";

describe("plan catalog", () => {
  it("FREE limits match product spec", () => {
    const free = PLAN_BY_SKU.free;
    expect(free.limits.activeEvents).toBe(1);
    expect(free.limits.attendees).toBe(50);
    expect(free.limits.aiIngestPerEvent).toBe(1);
    expect(resolveEntitlement(free, "hide_powered_by_badge")).toBe(false);
    expect(resolveEntitlement(free, "community")).toBe(true);
  });

  it("PRO unlocks analytics and clears event cap", () => {
    const pro = PLAN_BY_SKU.pro_annual;
    expect(pro.limits.activeEvents).toBeNull();
    expect(resolveEntitlement(pro, "analytics")).toBe(true);
    expect(resolveEntitlement(pro, "hide_powered_by_badge")).toBe(true);
  });

  it("INTERNAL is unlimited via tier helper", () => {
    const def = planDefinitionForTier("INTERNAL");
    expect(def.limits.attendees).toBeNull();
    expect(resolveEntitlement(def, "sso")).toBe(true);
  });

  it("formats display prices and exposes price-lock copy", () => {
    expect(formatDisplayPrice(0)).toBe("Free");
    expect(formatDisplayPrice(7900, "usd", "month")).toContain("/mo");
    expect(PRICE_LOCK.headline.toLowerCase()).toContain("price lock");
  });
});

describe("mock signed webhooks", () => {
  beforeEach(() => {
    process.env.BILLING_PROVIDER = "mock";
    process.env.BILLING_WEBHOOK_SECRET = "test-webhook-secret";
    resetBillingProviderForTests();
  });

  it("verifies HMAC and rejects bad signatures", () => {
    const provider = new MockBillingProvider("test-webhook-secret");
    const body = mockSubscriptionPayload("subscription_created", {
      orgId: "org_1",
      planKey: "pro_monthly",
      externalEventId: "evt_sig_1",
    });
    const { raw, signature } = signMockWebhook(body, "test-webhook-secret");
    const verified = provider.verifyWebhook(raw, signature);
    expect(verified.type).toBe("subscription_created");
    expect(verified.externalEventId).toBe("evt_sig_1");
    expect(() => provider.verifyWebhook(raw, "deadbeef")).toThrow(/signature/i);
  });

  it("signs order_created payloads for FREE→paid flows", () => {
    const body = mockOrderCreatedPayload({
      orgId: "org_1",
      planKey: "per_event_500",
      eventId: "evt_1",
    });
    const { raw, signature } = signMockWebhook(body);
    const provider = new MockBillingProvider();
    const verified = provider.verifyWebhook(raw, signature);
    expect(verified.type).toBe("order_created");
  });
});

describe("grace period helpers", () => {
  it("read-only after PAST_DUE grace ends", () => {
    const past = new Date(Date.now() - 60_000);
    expect(
      isOrgReadOnly({
        plan: "PRO",
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: past,
      }),
    ).toBe(true);
    expect(
      isInGracePeriod({
        plan: "PRO",
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: past,
      }),
    ).toBe(false);
  });

  it("in grace when PAST_DUE but end is future", () => {
    const future = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    expect(
      isOrgReadOnly({
        plan: "PRO",
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: future,
      }),
    ).toBe(false);
    expect(
      isInGracePeriod({
        plan: "PRO",
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: future,
      }),
    ).toBe(true);
  });

  it("INTERNAL never read-only from grace", () => {
    expect(
      isOrgReadOnly({
        plan: "INTERNAL",
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: new Date(0),
      }),
    ).toBe(false);
  });
});
