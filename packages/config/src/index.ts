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
  /** Live Better Stack status page (uptime monitoring configured 2026-08-02). */
  statusPageUrl: "https://ukedl.betteruptime.com",
  social: {
    x: "https://x.com/ukedl",
    linkedin: "https://www.linkedin.com/company/ukedl",
  },
  /** Subprocessors named in the privacy policy (Chunk B). */
  subprocessors: [
    { name: "Neon", role: "PostgreSQL hosting" },
    { name: "Render", role: "API hosting" },
    { name: "Netlify", role: "Web hosting" },
    { name: "Resend", role: "Transactional email" },
    { name: "Stripe", role: "Merchant of record (payments, tax)" },
    { name: "Anthropic", role: "AI processing for organizer-initiated features" },
    { name: "Sentry", role: "Error tracking" },
    { name: "Better Stack", role: "Uptime monitoring and status page" },
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

/**
 * Search-facing marketing copy (Chunk E25). The launch channel is inbound
 * search: buyers type category problems ("conference schedule software"),
 * not brand names, so every marketing <title> leads with category words and
 * ends with the brand. The hero H1 tagline is separate and unchanged — it
 * converts humans; these strings convert searchers.
 *
 * Marketing surfaces ONLY. Signed-in app pages keep their "Brand — Page"
 * titles. Edit this module, not the pages.
 */
export const marketingSeo = {
  /** Plain category descriptor — rendered near the wordmark (footer, hero). */
  categoryLine: "Event software for academic conferences",
  /** Homepage <title>: category first, brand last — the pattern for every marketing title. */
  seoTitle: `Conference schedule software for academic events — ${brand.productName}`,
  pages: {
    home: {
      title: `Conference schedule software for academic events — ${brand.productName}`,
      description:
        "Turn a conference program — PDF, Word, Excel or paste — into a published event site in minutes. Papers and presentations with ordered authors, CFP, calm notifications.",
    },
    pricing: {
      title: `Pricing — open, no sales calls — ${brand.productName} conference software`,
      description:
        "Open pricing for conference schedule software: a free tier, one-time per-event plans, and Pro subscriptions. Every price is public — no sales calls, no quote gate.",
    },
    help: {
      title: `Help — ${brand.productName} conference software`,
      description:
        "Guides for publishing a conference program online — importing sessions from PDF, Word, Excel or CSV, organizing papers, presentations and speakers, and attendee FAQs.",
    },
    security: {
      title: `Security & data practices — ${brand.productName} conference software`,
      description:
        "Security and data practices for conference software: architecture, subprocessors, data export and continuity, and the product principles we publish as true.",
    },
    /** Comparison pages (Chunk E27) — highest-intent "alternative" queries. */
    compareSched: {
      title: `Sched alternative for academic conferences — ${brand.productName} vs Sched`,
      description:
        "Sched alternative for academic conferences: papers inside sessions with ordered authors, AI import of the PDF or Word programme you already have, and open pricing.",
    },
    compareWhova: {
      title: `Whova alternative for academic conferences — ${brand.productName} vs Whova`,
      description:
        "Whova alternative for academic conferences: public pricing without a sales call, calm digest-first notifications, and papers, authors and CFP in the data model.",
    },
  },
} as const;

/** <title> for a help article: article topic first (what the searcher asked), brand last. */
export function marketingArticleTitle(articleTitle: string): string {
  return `${articleTitle} — ${brand.productName} conference software`;
}

/**
 * Organizer-console copy for what a session can hold (Chunk E11.3).
 * One combined "+ Add" entry point, two preserved models — Paper and
 * SessionResource stay separate models with separate endpoints; only the
 * wording lives here. Edit this module, not the components.
 */
export const programCopy = {
  /** Rendered as "+ {addEntryLabel}" under each session in the Program tab. */
  addEntryLabel: "Add paper or resource",
  paper: {
    noun: "Paper",
    hint: "A paper or presentation — authors or presenters in order, with an optional abstract. Appears in the program under the session.",
  },
  resource: {
    noun: "Resource",
    hint: "A link or file, e.g. slides, a reading list, a Drive folder.",
    /**
     * Shown above the add-resource form (Chunk E12.4). Plain English only —
     * never mention the transport (the 4.5 MB ceiling is the browser
     * request-encoding limit, RESOURCE_DATA_URL_MAX_CHARS, not a storage limit).
     */
    shareHint: "Add a link, or upload a file up to 4.5 MB. Anyone who joins this session can open it.",
  },
} as const;

/**
 * Customer-facing billing status copy (Chunk E24).
 * The raw SubscriptionStatus enum (NONE / ACTIVE / TRIALING / PAST_DUE /
 * CANCELED) must never be rendered on a customer surface. A status line is
 * shown only when it tells the customer something the plan name and price do
 * not already say. Edit this module, not the billing page.
 */
export const billingCopy = {
  status: {
    trial: "Free trial",
    trialEnds: (endsOn: string) => `Free trial — ends ${endsOn}`,
    /** The one that earns money: say what failed and what to do. */
    pastDue: (planName: string) => `Payment failed — update your card to keep ${planName}.`,
    cancelledEnds: (planName: string, endsOn: string) => `Cancelled — ${planName} access ends ${endsOn}.`,
    cancelledPaidThrough: (planName: string) =>
      `Cancelled — ${planName} access continues until the end of the period you already paid for.`,
  },
  /** Friendly labels for payment-provider invoice statuses (Stripe et al. send lowercase). */
  invoiceStatus: {
    paid: "Paid",
    open: "Awaiting payment",
    draft: "Draft",
    void: "Void",
    uncollectible: "Uncollectible",
    pending: "Pending",
    failed: "Failed",
    refunded: "Refunded",
  } as Record<string, string>,
} as const;

export type SubscriptionStatusLine = {
  text: string;
  /** "danger" = act now (payment failed); "warning" = heads-up; "neutral" = informational. */
  tone: "neutral" | "warning" | "danger";
};

/**
 * Decide whether the billing page shows a subscription status line, and what
 * it says. Returns null when there is nothing worth telling the customer —
 * NONE and ACTIVE add nothing to the plan name and price, and unknown enum
 * values must never leak to a customer surface.
 */
export function subscriptionStatusLine(input: {
  /** Raw SubscriptionStatus enum value from the API — never rendered directly. */
  subscriptionStatus: string;
  /** Plan tier id ("FREE", "PRO", …) — decides whether CANCELED still matters. */
  planTier: string;
  /** Display plan name, e.g. "Pro". */
  planName: string;
  /** Pre-formatted, locale-appropriate dates; omit when unknown. */
  trialEndsOn?: string | null;
  paidAccessEndsOn?: string | null;
}): SubscriptionStatusLine | null {
  switch (input.subscriptionStatus) {
    case "TRIALING":
      return {
        text: input.trialEndsOn ? billingCopy.status.trialEnds(input.trialEndsOn) : billingCopy.status.trial,
        tone: "neutral",
      };
    case "PAST_DUE":
      return { text: billingCopy.status.pastDue(input.planName), tone: "danger" };
    case "CANCELED":
      // After the downgrade the org is FREE and the plan panel already says
      // Free — never print a cancellation notice beside the Free plan.
      if (input.planTier === "FREE") return null;
      return {
        text: input.paidAccessEndsOn
          ? billingCopy.status.cancelledEnds(input.planName, input.paidAccessEndsOn)
          : billingCopy.status.cancelledPaidThrough(input.planName),
        tone: "warning",
      };
    default:
      return null;
  }
}

/** Map a provider invoice status ("paid", "open", …) to a customer-facing label. */
export function invoiceStatusLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  return billingCopy.invoiceStatus[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

/** ICS PRODID / calendar identity derived from brand (never hardcode product name). */
export function icsProductId(calendar = "Agenda"): string {
  return `-//${brand.productName}//${calendar}//EN`;
}
