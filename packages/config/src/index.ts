/**
 * Central product branding / legal config.
 * Rename the product by changing this module only — do not hardcode the name elsewhere.
 */
export const brand = {
  /** Working name — final rename is a one-line change here. */
  productName: "Colloquium",
  /** Placeholder until domain cutover. */
  domain: "colloquium.example",
  /** Absolute origin for canonical URLs / OG (no trailing slash). */
  primaryUrl: "https://colloquium.example",
  supportEmail: "support@colloquium.example",
  legalEntity: "Colloquium LLC (pending formation)",
  logoAlt: "Product logo",
  /** Reserved public demo event slug (seeded in Phase 6 Chunk C). */
  demoEventSlug: "demo",
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
  statusPageUrl: "https://status.colloquium.example",
  social: {
    x: "https://x.com/colloquium",
    linkedin: "https://www.linkedin.com/company/colloquium",
  },
  /** Subprocessors named in the privacy policy (Chunk B). */
  subprocessors: [
    { name: "Lemon Squeezy", role: "Merchant of record (payments, tax)" },
    { name: "Neon", role: "PostgreSQL hosting" },
    { name: "Render", role: "API hosting" },
    { name: "Netlify", role: "Web hosting" },
    { name: "Resend", role: "Transactional email (when configured)" },
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
