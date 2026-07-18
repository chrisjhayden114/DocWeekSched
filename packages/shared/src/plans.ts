/**
 * Data-driven plan catalog (Phase 3).
 * Change display prices / limits here — no route logic required.
 */

import type { FeatureKey } from "./features";

export type PlanTierId = "FREE" | "PER_EVENT" | "PRO" | "ENTERPRISE" | "INTERNAL";

/** SKUs sold or granted — pricing page + checkout keys. */
export type PlanSkuKey =
  | "free"
  | "per_event_250"
  | "per_event_500"
  | "per_event_1000"
  | "pro_monthly"
  | "pro_annual"
  | "enterprise"
  | "internal";

export type LimitKey = "activeEvents" | "attendees" | "aiIngestPerEvent" | "aiConciergePerEvent";

/** Extra plan flags beyond the event feature registry. */
export type PlanFlagKey =
  | "analytics"
  | "ai_ingest"
  | "ai_full_suite"
  | "priority_support"
  | "sso"
  | "white_label"
  | "hide_powered_by_badge";

export type EntitlementKey = FeatureKey | PlanFlagKey;

export type PlanInterval = "one_time" | "month" | "year" | null;

export type PlanDefinition = {
  sku: PlanSkuKey;
  tier: PlanTierId;
  name: string;
  plainDescription: string;
  /** Display amount in cents (tax-inclusive where MoR requires). null = contact / custom. */
  displayPriceCents: number | null;
  currency: string;
  interval: PlanInterval;
  /** null = unlimited */
  limits: Record<LimitKey, number | null>;
  /** Features / flags this plan grants. Absent key = false (except INTERNAL). */
  entitlements: Partial<Record<EntitlementKey, boolean>>;
  /** Shown on pricing / checkout — public. */
  public: boolean;
  contactOnly?: boolean;
};

const CORE_ATTENDEE_FEATURES: Partial<Record<EntitlementKey, boolean>> = {
  community: true,
  community_meetups: true,
  community_moments: true,
  community_local: true,
  community_icebreakers: true,
  community_general: true,
  messaging_dms: true,
  messaging_groups: true,
  messaging_event_chat: true,
  session_qa: true,
  session_likes: true,
  timezone_toggle: true,
  attendee_directory: true,
  engagement_points: false,
  public_leaderboard: false,
  matchmaker: false,
  concierge: true,
  venue_maps: true,
  waitlist_visibility: false,
  daily_digest: false,
  analytics: false,
  ai_ingest: true,
  ai_full_suite: false,
  priority_support: false,
  sso: false,
  white_label: false,
  hide_powered_by_badge: false,
};

const BASELINE_ALL: Partial<Record<EntitlementKey, boolean>> = {
  ...CORE_ATTENDEE_FEATURES,
  engagement_points: true,
  session_likes: true,
  hide_powered_by_badge: true,
  ai_ingest: true,
};

const PRO_ENTITLEMENTS: Partial<Record<EntitlementKey, boolean>> = {
  ...BASELINE_ALL,
  analytics: true,
  ai_full_suite: true,
  priority_support: true,
  daily_digest: true,
  engagement_points: true,
};

const INTERNAL_ENTITLEMENTS: Partial<Record<EntitlementKey, boolean>> = {
  ...PRO_ENTITLEMENTS,
  sso: true,
  white_label: true,
  matchmaker: true,
  concierge: true,
  venue_maps: true,
  waitlist_visibility: true,
  public_leaderboard: true,
};

export const PLAN_CATALOG: PlanDefinition[] = [
  {
    sku: "free",
    tier: "FREE",
    name: "Free",
    plainDescription: "One active event, 50 attendees, core agenda and community — with a small “Powered by” badge.",
    displayPriceCents: 0,
    currency: "usd",
    interval: null,
    limits: { activeEvents: 1, attendees: 50, aiIngestPerEvent: 1, aiConciergePerEvent: 50 },
    entitlements: { ...CORE_ATTENDEE_FEATURES, ai_ingest: true },
    public: true,
  },
  {
    sku: "per_event_250",
    tier: "PER_EVENT",
    name: "Per-event · 250",
    plainDescription: "One-time purchase for a single event up to 250 attendees. All baseline features; no badge.",
    displayPriceCents: 14900,
    currency: "usd",
    interval: "one_time",
    limits: { activeEvents: 1, attendees: 250, aiIngestPerEvent: 5, aiConciergePerEvent: 500 },
    entitlements: { ...BASELINE_ALL },
    public: true,
  },
  {
    sku: "per_event_500",
    tier: "PER_EVENT",
    name: "Per-event · 500",
    plainDescription: "One-time purchase for a single event up to 500 attendees.",
    displayPriceCents: 24900,
    currency: "usd",
    interval: "one_time",
    limits: { activeEvents: 1, attendees: 500, aiIngestPerEvent: 10, aiConciergePerEvent: 1000 },
    entitlements: { ...BASELINE_ALL },
    public: true,
  },
  {
    sku: "per_event_1000",
    tier: "PER_EVENT",
    name: "Per-event · 1,000",
    plainDescription: "One-time purchase for a single event up to 1,000 attendees.",
    displayPriceCents: 39900,
    currency: "usd",
    interval: "one_time",
    limits: { activeEvents: 1, attendees: 1000, aiIngestPerEvent: 20, aiConciergePerEvent: 2000 },
    entitlements: { ...BASELINE_ALL },
    public: true,
  },
  {
    sku: "pro_monthly",
    tier: "PRO",
    name: "Pro · Monthly",
    plainDescription: "Unlimited events, higher caps, analytics, engagement features, and the full AI suite.",
    displayPriceCents: 7900,
    currency: "usd",
    interval: "month",
    limits: { activeEvents: null, attendees: 2000, aiIngestPerEvent: null, aiConciergePerEvent: 5000 },
    entitlements: { ...PRO_ENTITLEMENTS },
    public: true,
  },
  {
    sku: "pro_annual",
    tier: "PRO",
    name: "Pro · Annual",
    plainDescription: "Pro billed yearly — same entitlements, locked price for recurring series.",
    displayPriceCents: 79000,
    currency: "usd",
    interval: "year",
    limits: { activeEvents: null, attendees: 2000, aiIngestPerEvent: null, aiConciergePerEvent: 5000 },
    entitlements: { ...PRO_ENTITLEMENTS },
    public: true,
  },
  {
    sku: "enterprise",
    tier: "ENTERPRISE",
    name: "Enterprise",
    plainDescription: "SSO, white-label, and custom limits — contact us.",
    displayPriceCents: null,
    currency: "usd",
    interval: null,
    limits: { activeEvents: null, attendees: null, aiIngestPerEvent: null, aiConciergePerEvent: null },
    entitlements: { ...INTERNAL_ENTITLEMENTS },
    public: true,
    contactOnly: true,
  },
  {
    sku: "internal",
    tier: "INTERNAL",
    name: "Internal / Comp",
    plainDescription: "Unlimited grandfathered plan — not sold publicly.",
    displayPriceCents: null,
    currency: "usd",
    interval: null,
    limits: { activeEvents: null, attendees: null, aiIngestPerEvent: null, aiConciergePerEvent: null },
    entitlements: { ...INTERNAL_ENTITLEMENTS },
    public: false,
  },
];

export const PLAN_BY_SKU: Record<PlanSkuKey, PlanDefinition> = Object.fromEntries(
  PLAN_CATALOG.map((p) => [p.sku, p]),
) as Record<PlanSkuKey, PlanDefinition>;

/** Default SKU for a stored PlanTier (subscriptions use pro_annual as display default). */
export function defaultSkuForTier(tier: PlanTierId | null | undefined): PlanSkuKey {
  switch (tier) {
    case "PER_EVENT":
      return "per_event_250";
    case "PRO":
      return "pro_annual";
    case "ENTERPRISE":
      return "enterprise";
    case "INTERNAL":
      return "internal";
    case "FREE":
    default:
      return "free";
  }
}

export function planDefinitionForTier(tier: PlanTierId | null | undefined): PlanDefinition {
  return PLAN_BY_SKU[defaultSkuForTier(tier)];
}

export function resolveEntitlement(
  def: PlanDefinition,
  key: EntitlementKey,
): boolean {
  if (def.tier === "INTERNAL") return true;
  return Boolean(def.entitlements[key]);
}

/** Recurring-event price lock — public copy + helpers for /pricing and series UI. */
export const PRICE_LOCK = {
  headline: "Recurring-event price lock",
  body:
    "When you run the same conference every year as an Event Series, we lock the plan price you purchased for that series. Your next edition keeps that rate — no surprise annual reprice.",
  footnote: "Price lock is stored on the series at purchase time and shown from this plan catalog.",
} as const;

export function formatDisplayPrice(cents: number | null, currency = "usd", interval: PlanInterval = null): string {
  if (cents == null) return "Contact us";
  if (cents === 0) return "Free";
  const amount = (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
  if (interval === "month") return `${amount}/mo`;
  if (interval === "year") return `${amount}/yr`;
  if (interval === "one_time") return `${amount} one-time`;
  return amount;
}

export function publicPricingPlans(): PlanDefinition[] {
  return PLAN_CATALOG.filter((p) => p.public);
}
