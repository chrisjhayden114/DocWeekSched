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

const STRIPE_API_BASE = "https://api.stripe.com";

/** Stripe recommends rejecting webhook timestamps older than 5 minutes. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

/** One-time SKUs check out in payment mode; Pro plans are subscriptions. */
export function stripeModeForPlan(planKey: PlanSkuKey): "payment" | "subscription" {
  return planKey === "pro_monthly" || planKey === "pro_annual" ? "subscription" : "payment";
}

/**
 * Stripe Managed Payments MoR provider (Stripe as merchant of record — tax,
 * disputes, fraud). Same surface as the Lemon Squeezy provider: raw fetch
 * against the Stripe API (no SDK) + node:crypto webhook verification.
 * Checkout sessions opt in via managed_payments[enabled]=true.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly priceIds: Partial<Record<PlanSkuKey, string>>;
  private readonly apiVersion: string;

  constructor(opts?: {
    secretKey?: string;
    webhookSecret?: string;
    priceIds?: Partial<Record<PlanSkuKey, string>>;
    apiVersion?: string;
  }) {
    this.secretKey = (opts?.secretKey ?? process.env.STRIPE_SECRET_KEY ?? "").trim();
    this.webhookSecret = (opts?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
    this.priceIds = opts?.priceIds ?? readPriceIdsFromEnv();
    // Managed Payments is in preview; some accounts need a pinned API version.
    this.apiVersion = (opts?.apiVersion ?? process.env.STRIPE_API_VERSION ?? "").trim();
  }

  isConfigured(): boolean {
    return Boolean(
      this.secretKey &&
        this.priceIds.per_event_250 &&
        this.priceIds.per_event_500 &&
        this.priceIds.per_event_1000 &&
        this.priceIds.pro_monthly &&
        this.priceIds.pro_annual,
    );
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!this.isConfigured()) {
      throw new Error("Stripe is not configured");
    }
    const priceId = this.priceIds[input.planKey];
    if (!priceId) {
      throw new Error(`No Stripe price mapped for plan ${input.planKey}`);
    }
    const mode = stripeModeForPlan(input.planKey);

    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", input.successUrl);
    params.set("cancel_url", input.cancelUrl);
    params.set("managed_payments[enabled]", "true");
    // Payment-mode (one-time) checkouts do not create invoices unless asked.
    // Subscription mode already invoices and Stripe rejects this flag there.
    if (mode === "payment") {
      params.set("invoice_creation[enabled]", "true");
    }
    if (input.customerEmail) params.set("customer_email", input.customerEmail);

    const metadata: Record<string, string> = {
      orgId: input.orgId,
      planKey: input.planKey,
      eventId: input.eventId || "",
    };
    // Also copy onto the subscription / payment intent so webhooks firing on
    // those objects (not just the session) can recover org + plan.
    const nested = mode === "subscription" ? "subscription_data" : "payment_intent_data";
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`${nested}[metadata][${key}]`, value);
    }

    const json = await this.request("POST", "/v1/checkout/sessions", params);
    const url = typeof json.url === "string" ? json.url : "";
    const checkoutId = typeof json.id === "string" ? json.id : "";
    if (!url || !checkoutId) throw new Error("Stripe checkout session response missing url");
    return { url, checkoutId };
  }

  async createCustomerPortal(input: PortalInput): Promise<PortalResult> {
    const params = new URLSearchParams();
    params.set("customer", input.customerId);
    params.set("return_url", input.returnUrl);
    const json = await this.request("POST", "/v1/billing_portal/sessions", params);
    const url = typeof json.url === "string" ? json.url : "";
    if (!url) throw new Error("Stripe billing portal response missing url");
    return { url };
  }

  /**
   * Manual Stripe-Signature verification: header carries `t=<unix>,v1=<hex>[,v1=...]`;
   * the signed payload is `${t}.${rawBody}` HMAC-SHA256 with the webhook secret.
   */
  verifyWebhook(rawBody: Buffer | string, signatureHeader: string | undefined): VerifiedWebhook {
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");

    let timestamp = "";
    const candidates: string[] = [];
    for (const part of signatureHeader.split(",")) {
      const idx = part.indexOf("=");
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key === "t") timestamp = value;
      else if (key === "v1") candidates.push(value);
    }
    const ts = Number(timestamp);
    if (!timestamp || !Number.isFinite(ts) || candidates.length === 0) {
      throw new Error("Malformed Stripe-Signature header");
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - ts);
    if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
      throw new Error("Stripe webhook timestamp outside tolerance (stale or future-dated)");
    }
    const expected = createHmac("sha256", this.webhookSecret).update(`${timestamp}.${raw}`).digest("hex");
    if (!candidates.some((candidate) => safeEqualHex(candidate, expected))) {
      throw new Error("Invalid Stripe webhook signature");
    }

    const payload = JSON.parse(raw) as Record<string, unknown>;
    const externalEventId = typeof payload.id === "string" ? payload.id : "";
    if (!externalEventId) throw new Error("Webhook missing event id");
    const type = typeof payload.type === "string" ? payload.type : "unknown";
    return { provider: "STRIPE", externalEventId, type, payload };
  }

  async listInvoices(customerId: string) {
    const json = await this.request(
      "GET",
      `/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=12`,
    );
    const data = Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : [];
    return data.map((invoice) => ({
      id: String(invoice.id || ""),
      status: String(invoice.status || ""),
      amountCents: Number(invoice.amount_paid ?? invoice.amount_due ?? 0),
      currency: String(invoice.currency || "usd"),
      createdAt: new Date(Number(invoice.created || 0) * 1000).toISOString(),
      url: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined,
    }));
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    params?: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${STRIPE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(this.apiVersion ? { "Stripe-Version": this.apiVersion } : {}),
      },
      body: params ? params.toString() : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe request ${path} failed (${res.status}): ${text.slice(0, 400)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function readPriceIdsFromEnv(): Partial<Record<PlanSkuKey, string>> {
  return {
    per_event_250: process.env.STRIPE_PRICE_PER_EVENT_250?.trim(),
    per_event_500: process.env.STRIPE_PRICE_PER_EVENT_500?.trim(),
    per_event_1000: process.env.STRIPE_PRICE_PER_EVENT_1000?.trim(),
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY?.trim(),
    pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL?.trim(),
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
