import type { PlanSkuKey } from "@event-app/shared";

export type CheckoutInput = {
  orgId: string;
  planKey: PlanSkuKey;
  eventId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult = {
  url: string;
  checkoutId: string;
};

export type PortalInput = {
  orgId: string;
  customerId: string;
  returnUrl: string;
};

export type PortalResult = {
  url: string;
};

export type VerifiedWebhook = {
  provider: "LEMON_SQUEEZY" | "MOCK" | "NONE";
  externalEventId: string;
  type: string;
  payload: Record<string, unknown>;
};

/**
 * Merchant-of-record billing backend.
 * Lemon Squeezy is default; Stripe/Paddle can implement the same surface later.
 */
export interface BillingProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createCustomerPortal(input: PortalInput): Promise<PortalResult>;
  /**
   * Verify signature and parse. Throws on invalid signature.
   * `rawBody` must be the exact bytes/string used for HMAC.
   */
  verifyWebhook(rawBody: Buffer | string, signatureHeader: string | undefined): VerifiedWebhook;
  /** List invoice summaries when the MoR supports it (may be empty). */
  listInvoices?(customerId: string): Promise<
    Array<{ id: string; status: string; amountCents: number; currency: string; createdAt: string; url?: string }>
  >;
}
