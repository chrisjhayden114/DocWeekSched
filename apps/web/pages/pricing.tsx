import { brand } from "@event-app/config";
import {
  PRICE_LOCK,
  formatDisplayPrice,
  publicPricingPlans,
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

export default function PricingPage() {
  const plans = publicPricingPlans();
  const title = `Pricing — ${brand.productName}`;
  const description = `Honest, public pricing for ${brand.productName}. Recurring-event price lock included.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={`${brand.primaryUrl}/pricing`} />
        <meta property="og:site_name" content={brand.productName} />
        <link rel="canonical" href={`${brand.primaryUrl}/pricing`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 960 }}>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Honest pricing
            </h1>
            <p className="text-body-lg" style={{ color: "var(--ink-secondary)", maxWidth: 560 }}>
              Checkout is handled by Lemon Squeezy (merchant of record) — they collect payment and applicable
              sales tax/VAT. Catalog amounts below match what we charge before tax.
            </p>

            <section className="mkt-price-lock">
              <h2 className="text-display-sm" style={{ margin: "0 0 8px" }}>
                {PRICE_LOCK.headline}
              </h2>
              <p style={{ margin: 0, maxWidth: 640 }}>{PRICE_LOCK.body}</p>
              <p className="text-meta" style={{ marginTop: 10 }}>
                {PRICE_LOCK.footnote}
              </p>
            </section>

            <div className="mkt-plan-grid">
              {plans.map((p) => (
                <article key={p.sku} className="mkt-plan-card">
                  <h3 style={{ margin: "0 0 6px" }}>{p.name}</h3>
                  <p className="mkt-plan-price">
                    {formatDisplayPrice(p.displayPriceCents, p.currency, p.interval)}
                  </p>
                  <p className="help-text" style={{ marginTop: 0, minHeight: 72 }}>
                    {p.plainDescription}
                  </p>
                  <ul className="help-text" style={{ paddingLeft: 18, margin: "0 0 16px" }}>
                    <li>Events: {p.limits.activeEvents == null ? "Unlimited" : p.limits.activeEvents}</li>
                    <li>
                      Attendees / event:{" "}
                      {p.limits.attendees == null ? "Unlimited" : p.limits.attendees.toLocaleString()}
                    </li>
                  </ul>
                  {p.contactOnly ? (
                    <a className="button secondary" href={`mailto:${brand.supportEmail}?subject=Enterprise%20plan`}>
                      Contact us
                    </a>
                  ) : p.sku === "free" ? (
                    <Link className="button" href="/login">
                      Start free
                    </Link>
                  ) : (
                    <Link className="button" href="/login">
                      Sign in to upgrade
                    </Link>
                  )}
                </article>
              ))}
            </div>

            <h2 className="text-display-md">FAQ</h2>
            <dl className="mkt-faq">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt className="text-display-sm">{item.q}</dt>
                  <dd className="text-body-md" style={{ color: "var(--ink-secondary)", marginLeft: 0 }}>
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="text-meta" style={{ marginTop: 28 }}>
              Tax note: Lemon Squeezy adds applicable sales tax/VAT at checkout where required. Displayed
              catalog prices are the pre-tax amounts from our plan config.
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
