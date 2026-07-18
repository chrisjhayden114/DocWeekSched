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
 * Lemon Squeezy MoR provider (sandbox + live via env).
 * Checkout uses the Store API; webhooks use X-Signature HMAC-SHA256 of the raw body.
 */
export class LemonSqueezyBillingProvider implements BillingProvider {
  readonly name = "lemonsqueezy";
  private readonly apiKey: string;
  private readonly storeId: string;
  private readonly webhookSecret: string;
  private readonly variantIds: Partial<Record<PlanSkuKey, string>>;

  constructor(opts?: {
    apiKey?: string;
    storeId?: string;
    webhookSecret?: string;
    variantIds?: Partial<Record<PlanSkuKey, string>>;
  }) {
    this.apiKey = (opts?.apiKey ?? process.env.LEMONSQUEEZY_API_KEY ?? "").trim();
    this.storeId = (opts?.storeId ?? process.env.LEMONSQUEEZY_STORE_ID ?? "").trim();
    this.webhookSecret = (opts?.webhookSecret ?? process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "").trim();
    this.variantIds = opts?.variantIds ?? readVariantIdsFromEnv();
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.storeId && this.webhookSecret);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!this.isConfigured()) {
      throw new Error("Lemon Squeezy is not configured");
    }
    const variantId = this.variantIds[input.planKey];
    if (!variantId) {
      throw new Error(`No Lemon Squeezy variant mapped for plan ${input.planKey}`);
    }

    const body = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: input.customerEmail,
            custom: {
              org_id: input.orgId,
              plan_key: input.planKey,
              event_id: input.eventId || "",
            },
          },
          product_options: {
            redirect_url: input.successUrl,
          },
          checkout_options: {
            button_color: "#0033A0",
          },
        },
        relationships: {
          store: { data: { type: "stores", id: this.storeId } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    };

    const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as {
      data?: { id?: string; attributes?: { url?: string } };
    };
    const url = json.data?.attributes?.url;
    const checkoutId = json.data?.id;
    if (!url || !checkoutId) throw new Error("Lemon Squeezy checkout response missing url");
    return { url, checkoutId };
  }

  async createCustomerPortal(input: PortalInput): Promise<PortalResult> {
    // LS customer portal is typically a store URL with customer auth; expose configured portal base.
    const portalBase =
      process.env.LEMONSQUEEZY_CUSTOMER_PORTAL_URL?.trim() ||
      `https://app.lemonsqueezy.com/my-orders`;
    const url = `${portalBase}${portalBase.includes("?") ? "&" : "?"}customer=${encodeURIComponent(input.customerId)}&return=${encodeURIComponent(input.returnUrl)}`;
    return { url };
  }

  verifyWebhook(rawBody: Buffer | string, signatureHeader: string | undefined): VerifiedWebhook {
    if (!this.webhookSecret) throw new Error("LEMONSQUEEZY_WEBHOOK_SECRET is not set");
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = createHmac("sha256", this.webhookSecret).update(raw).digest("hex");
    if (!signatureHeader || !safeEqualHex(signatureHeader, expected)) {
      throw new Error("Invalid Lemon Squeezy webhook signature");
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const meta = (payload.meta as Record<string, unknown> | undefined) || {};
    const data = (payload.data as Record<string, unknown> | undefined) || {};
    const externalEventId = String(meta.event_id || data.id || "");
    if (!externalEventId) throw new Error("Webhook missing event id");
    const type = String(meta.event_name || "unknown");
    return { provider: "LEMON_SQUEEZY", externalEventId, type, payload };
  }

  async listInvoices() {
    return [];
  }
}

function readVariantIdsFromEnv(): Partial<Record<PlanSkuKey, string>> {
  return {
    per_event_250: process.env.LEMONSQUEEZY_VARIANT_PER_EVENT_250,
    per_event_500: process.env.LEMONSQUEEZY_VARIANT_PER_EVENT_500,
    per_event_1000: process.env.LEMONSQUEEZY_VARIANT_PER_EVENT_1000,
    pro_monthly: process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY,
    pro_annual: process.env.LEMONSQUEEZY_VARIANT_PRO_ANNUAL,
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
