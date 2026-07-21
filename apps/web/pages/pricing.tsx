import { brand } from "@event-app/config";
import {
  PRICE_LOCK,
  PLAN_BY_SKU,
  formatDisplayPrice,
  type PlanDefinition,
} from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

const FAQ = [
  {
    q: "What counts as an attendee?",
    a: "Anyone invited to or joined into an event counts toward that event’s attendee cap on your plan.",
  },
  {
    q: "How do refunds work?",
    a: "Checkout and refunds are handled by Lemon Squeezy (merchant of record). Contact support with your order ID.",
  },
  {
    q: "What happens when I archive an event?",
    a: "Archived events leave the active-event count. Attendee data remains available to organizers for export until you delete it.",
  },
  {
    q: "What is the recurring-event price lock?",
    a: PRICE_LOCK.body,
  },
] as const;

type TierCard = {
  plan: PlanDefinition;
  popular?: boolean;
  /** Extra honest bullets beyond generated limits. */
  extras?: string[];
};

function limitFeatures(plan: PlanDefinition): string[] {
  const events =
    plan.limits.activeEvents == null ? "Unlimited active events" : `${plan.limits.activeEvents} active event`;
  const attendees =
    plan.limits.attendees == null
      ? "Unlimited attendees per event"
      : `Up to ${plan.limits.attendees.toLocaleString()} attendees per event`;
  const rows = [events, attendees];
  if (plan.entitlements.ai_ingest) rows.push("AI program ingest");
  if (plan.entitlements.analytics) rows.push("Analytics");
  if (plan.entitlements.ai_full_suite) rows.push("Full AI suite");
  if (plan.entitlements.sso) rows.push("SSO");
  if (plan.entitlements.white_label) rows.push("White-label");
  if (plan.entitlements.priority_support) rows.push("Priority support");
  if (plan.tier === "FREE") rows.push("Core agenda and community");
  if (plan.tier === "PER_EVENT" || plan.tier === "PRO") rows.push("No “Powered by” badge");
  return rows;
}

/** Three comparison tiers from the public catalog (display only). */
const TIERS: TierCard[] = [
  {
    plan: PLAN_BY_SKU.free,
    extras: ["Small “Powered by” badge on attendee surfaces"],
  },
  {
    plan: PLAN_BY_SKU.pro_monthly,
    popular: true,
    extras: [
      `Annual option: ${formatDisplayPrice(
        PLAN_BY_SKU.pro_annual.displayPriceCents,
        PLAN_BY_SKU.pro_annual.currency,
        PLAN_BY_SKU.pro_annual.interval,
      )}`,
    ],
  },
  {
    plan: PLAN_BY_SKU.enterprise,
    extras: ["Custom limits and procurement"],
  },
];

const PER_EVENT_SKUS = [
  PLAN_BY_SKU.per_event_250,
  PLAN_BY_SKU.per_event_500,
  PLAN_BY_SKU.per_event_1000,
] as const;

export default function PricingPage() {
  const title = `Pricing — ${brand.productName}`;
  const description = `Open pricing for ${brand.productName}. Free, Pro, Enterprise, and one-time per-event plans. Recurring-event price lock included.`;
  const url = `${brand.primaryUrl}/pricing`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content={brand.productName} />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main>
          <section className="mkt-section">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Pricing</p>
              <h1 className="mkt-h2" style={{ fontSize: 36 }}>
                Open pricing
              </h1>
              <p className="mkt-standfirst">
                Catalog amounts match what we charge before tax. Checkout is handled by Lemon Squeezy
                (merchant of record) — they collect payment and applicable sales tax/VAT.
              </p>

              <section className="mkt-price-lock" aria-labelledby="price-lock-heading">
                <h2 id="price-lock-heading" className="mkt-feature-title">
                  {PRICE_LOCK.headline}
                </h2>
                <p style={{ margin: "0 0 8px", maxWidth: 640, color: "var(--gray-700)" }}>{PRICE_LOCK.body}</p>
                <p className="text-meta" style={{ margin: 0 }}>
                  {PRICE_LOCK.footnote}
                </p>
              </section>

              <div className="mkt-plan-grid">
                {TIERS.map(({ plan, popular, extras }) => {
                  const features = [...limitFeatures(plan), ...(extras ?? [])];
                  return (
                    <article key={plan.sku} className={`mkt-plan-card${popular ? " is-popular" : ""}`}>
                      {popular ? <span className="mkt-plan-chip">Popular</span> : null}
                      <h3>{plan.name}</h3>
                      <p className="mkt-plan-price">
                        {formatDisplayPrice(plan.displayPriceCents, plan.currency, plan.interval)}
                      </p>
                      <p className="mkt-feature-body" style={{ margin: 0 }}>
                        {plan.plainDescription}
                      </p>
                      <ul className="mkt-plan-features">
                        {features.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      {plan.contactOnly ? (
                        <a
                          className="button secondary"
                          href={`mailto:${brand.supportEmail}?subject=Enterprise%20plan`}
                        >
                          Contact us
                        </a>
                      ) : plan.sku === "free" ? (
                        <Link className="button" href="/login?intent=create-event">
                          Start free
                        </Link>
                      ) : (
                        <Link className="button" href="/login">
                          Sign in to upgrade
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>

              <p className="mkt-eyebrow">One-time options</p>
              <h2 className="mkt-h2" style={{ fontSize: 24 }}>
                Per-event plans
              </h2>
              <p className="mkt-standfirst">
                Single-event purchases from the same catalog — useful when you are not ready for a Pro
                subscription.
              </p>
              <div className="mkt-plan-grid">
                {PER_EVENT_SKUS.map((plan) => (
                  <article key={plan.sku} className="mkt-plan-card">
                    <h3>{plan.name}</h3>
                    <p className="mkt-plan-price">
                      {formatDisplayPrice(plan.displayPriceCents, plan.currency, plan.interval)}
                    </p>
                    <p className="mkt-feature-body" style={{ margin: 0 }}>
                      {plan.plainDescription}
                    </p>
                    <ul className="mkt-plan-features">
                      {limitFeatures(plan).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <Link className="button secondary" href="/login">
                      Sign in to upgrade
                    </Link>
                  </article>
                ))}
              </div>

              <p className="mkt-eyebrow" style={{ marginTop: 16 }}>
                FAQ
              </p>
              <h2 className="mkt-h2">Common questions</h2>
              <div className="mkt-faq">
                {FAQ.map((item) => (
                  <details key={item.q}>
                    <summary>{item.q}</summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>

              <p className="text-meta" style={{ marginTop: 28 }}>
                Tax note: Lemon Squeezy adds applicable sales tax/VAT at checkout where required. Displayed
                catalog prices are the pre-tax amounts from our plan config.
              </p>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
