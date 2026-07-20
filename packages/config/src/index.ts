/**
 * Central product branding / legal config.
 * Rename the product by changing this module only — do not hardcode the name elsewhere.
 */
export const brand = {
  /**
   * NEUTRAL LAUNCH NAME — "Colloquium" is NOT trademark-cleared yet.
   * Launching under the existing UKEDL identity; swap in the cleared final
   * name here (one line) + redeploy once the attorney signs off.
   */
  productName: "UKEDL",
  domain: "ukedl.com",
  /** Absolute origin for canonical URLs / OG (no trailing slash). */
  primaryUrl: "https://ukedl.com",
  supportEmail: "support@ukedl.com",
  legalEntity: "UKEDL (sole proprietorship; entity formation pending)",
  logoAlt: "Product logo",
  /** Reserved public demo event slug (seeded in Phase 6 Chunk C). */
  demoEventSlug: "demo",
  /** Internal/founder org that owns the public demo (plan INTERNAL — not customer limits). */
  /**
   * Internal org slug is never rendered publicly — keeping the original value
   * so existing seeded demo data (dev) stays owned by the same org; the
   * demo-reset org check would otherwise refuse the old demo event.
   */
  internalOrgSlug: "colloquium-internal",
  internalOrgName: "Platform Internal",
  /** Honest support hours — used by ToS / security / help. */
  supportHours: "Weekdays 9:00–17:00 US Pacific. Event-day coverage is best-effort.",
  /**
   * Cookie consent banner: OFF.
   * Deliberate choice — today we set only essential session/CSRF cookies (see apps/api/src/lib/cookies.ts).
   * No non-essential analytics cookies are set. If Phase S3 adds Plausible/PostHog-class cookies that
   * require consent, flip this to true and ship a banner + privacy update in the same session.
   */
  cookieConsentRequired: false,
  /** Product principles (anti-goals) — published on /security. */
  productPrinciples: [
    "No ads",
    "No attendee-data monetization",
    "No engagement bait",
  ],
  /** Placeholder until S2 wires a real status provider. */
  statusPageUrl: "https://status.ukedl.com",
  social: {
    x: "https://x.com/ukedl",
    linkedin: "https://www.linkedin.com/company/ukedl",
  },
  /** Subprocessors named in the privacy policy (Chunk B). */
  subprocessors: [
    { name: "Lemon Squeezy", role: "Merchant of record (payments, tax)" },
    { name: "Neon", role: "PostgreSQL hosting" },
    { name: "Render", role: "API hosting" },
    { name: "Netlify", role: "Web hosting" },
    { name: "Resend", role: "Transactional email (when configured)" },
    { name: "Sentry", role: "Error tracking (when configured)" },
  ],
  colors: {
    ink: "#18253F",
    primary: "#0033A0",
    goldDecorative: "#E8C547",
  },
  /**
   * Legacy client storage keys from the pre-rename release. Dual-read these for one release;
   * always write the current keys in `clientStorageKeys`.
   */
  legacyClientStorageKeys: {
    linkedEventContext: "eventPilotLinkedContext",
    theme: "eventPilotTheme",
  },
  clientStorageKeys: {
    linkedEventContext: "linkedEventContext",
    theme: "appTheme",
  },
} as const;

export type BrandConfig = typeof brand;

/** ICS PRODID / calendar identity derived from brand (never hardcode product name). */
export function icsProductId(calendar = "Agenda"): string {
  return `-//${brand.productName}//${calendar}//EN`;
}
