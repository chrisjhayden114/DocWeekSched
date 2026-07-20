import { createHmac, timingSafeEqual } from "crypto";
import type { PlanSkuKey } from "@event-app/shared";
import type {
  BillingProvider,
  CheckoutInput,
  CheckoutResult,
  PortalInput,
  PortalResult,
  VerifiedWebhook,
} from "./types";

/**
 * Used when BILLING_PROVIDER is unset or mock — unit tests + local dev without LS keys.
 * Signs webhooks with HMAC-SHA256 hex of raw body (same shape as Lemon Squeezy-style verify).
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";
  private readonly secret: string;

  constructor(secret = process.env.BILLING_WEBHOOK_SECRET || "test-webhook-secret") {
    this.secret = secret;
  }

  isConfigured(): boolean {
    return true;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const checkoutId = `mock_chk_${input.planKey}_${Date.now()}`;
    const url = `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}mockCheckout=${checkoutId}&plan=${input.planKey}&org=${input.orgId}`;
    return { url, checkoutId };
  }

  async createCustomerPortal(input: PortalInput): Promise<PortalResult> {
    return {
      url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}mockPortal=1&customer=${input.customerId}`,
    };
  }

  verifyWebhook(rawBody: Buffer | string, signatureHeader: string | undefined): VerifiedWebhook {
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = createHmac("sha256", this.secret).update(raw).digest("hex");
    if (!signatureHeader || !safeEqualHex(signatureHeader, expected)) {
      throw new Error("Invalid webhook signature");
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const meta = (payload.meta as Record<string, unknown> | undefined) || {};
    const data = (payload.data as Record<string, unknown> | undefined) || {};
    const externalEventId = String(meta.event_id || meta.id || data.id || `mock_${Date.now()}`);
    const type = String(meta.event_name || payload.event_name || "unknown");
    return { provider: "MOCK", externalEventId, type, payload };
  }

  async listInvoices() {
    return [];
  }
}

/** Build a signed mock Lemon-style webhook body for tests. */
export function signMockWebhook(
  body: Record<string, unknown>,
  secret = process.env.BILLING_WEBHOOK_SECRET || "test-webhook-secret",
): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return { raw, signature };
}

export function mockOrderCreatedPayload(opts: {
  orgId: string;
  planKey: PlanSkuKey;
  eventId?: string;
  customerId?: string;
  orderId?: string;
  eventIdExternal?: string;
}): Record<string, unknown> {
  return {
    meta: {
      event_name: "order_created",
      event_id: opts.eventIdExternal || `evt_order_${Date.now()}`,
      custom_data: {
        org_id: opts.orgId,
        plan_key: opts.planKey,
        event_id: opts.eventId || null,
      },
    },
    data: {
      id: opts.orderId || `order_${Date.now()}`,
      type: "orders",
      attributes: {
        status: "paid",
        customer_id: opts.customerId || `cust_${Date.now()}`,
      },
    },
  };
}

export function mockSubscriptionPayload(
  eventName: string,
  opts: {
    orgId: string;
    planKey: PlanSkuKey;
    customerId?: string;
    subscriptionId?: string;
    externalEventId?: string;
  },
): Record<string, unknown> {
  return {
    meta: {
      event_name: eventName,
      event_id: opts.externalEventId || `evt_sub_${Date.now()}`,
      custom_data: {
        org_id: opts.orgId,
        plan_key: opts.planKey,
      },
    },
    data: {
      id: opts.subscriptionId || `sub_${Date.now()}`,
      type: "subscriptions",
      attributes: {
        status: eventName.includes("cancelled") ? "cancelled" : eventName.includes("failed") ? "past_due" : "active",
        customer_id: opts.customerId || `cust_${Date.now()}`,
      },
    },
  };
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export class UnconfiguredBillingProvider implements BillingProvider {
  readonly name = "none";

  isConfigured(): boolean {
    return false;
  }

  async createCheckout(): Promise<CheckoutResult> {
    throw new Error("Billing is not configured. Set BILLING_PROVIDER=lemonsqueezy (or mock) and keys.");
  }

  async createCustomerPortal(): Promise<PortalResult> {
    throw new Error("Billing is not configured.");
  }

  verifyWebhook(): VerifiedWebhook {
    throw new Error("Billing webhooks are not configured.");
  }
}
