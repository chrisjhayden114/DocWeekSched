import { LemonSqueezyBillingProvider } from "./lemonSqueezy";
import { MockBillingProvider, UnconfiguredBillingProvider } from "./mock";
import type { BillingProvider } from "./types";

export type { BillingProvider, CheckoutInput, CheckoutResult, PortalInput, PortalResult, VerifiedWebhook } from "./types";
export {
  can,
  limit,
  loadOrgBilling,
  assertCanCreateEvent,
  assertCanAddAttendee,
  assertOrgWritable,
  applyPlanSkuToOrg,
  markPaymentFailed,
  markSubscriptionCanceled,
  effectiveAttendeeCap,
  upgradePayload,
  GRACE_PERIOD_DAYS,
  isOrgReadOnly,
  isInGracePeriod,
} from "./entitlements";
export { processVerifiedWebhook } from "./webhooks";
export {
  MockBillingProvider,
  UnconfiguredBillingProvider,
  signMockWebhook,
  mockOrderCreatedPayload,
  mockSubscriptionPayload,
} from "./mock";
export { LemonSqueezyBillingProvider } from "./lemonSqueezy";

let cached: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  const name = (process.env.BILLING_PROVIDER || "").trim().toLowerCase();
  if (name === "lemonsqueezy" || name === "lemon_squeezy" || name === "lemon-squeezy") {
    const ls = new LemonSqueezyBillingProvider();
    cached = ls.isConfigured() ? ls : new UnconfiguredBillingProvider();
    return cached;
  }
  if (name === "mock" || name === "test" || process.env.NODE_ENV === "test") {
    cached = new MockBillingProvider();
    return cached;
  }
  // Dev convenience: mock when no MoR keys so checkout/portal don't crash the UI.
  if (!name || name === "none" || name === "unconfigured") {
    if (process.env.LEMONSQUEEZY_API_KEY?.trim()) {
      const ls = new LemonSqueezyBillingProvider();
      cached = ls.isConfigured() ? ls : new MockBillingProvider();
      return cached;
    }
    cached = process.env.NODE_ENV === "production" ? new UnconfiguredBillingProvider() : new MockBillingProvider();
    return cached;
  }
  cached = new UnconfiguredBillingProvider();
  return cached;
}

export function resetBillingProviderForTests(): void {
  cached = null;
}
