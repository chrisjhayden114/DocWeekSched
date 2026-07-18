import { brand } from "@event-app/config";
import {
  PRICE_LOCK,
  formatDisplayPrice,
  publicPricingPlans,
} from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";

export default function PricingPage() {
  const plans = publicPricingPlans();

  return (
    <>
      <Head>
        <title>Pricing — {brand.productName}</title>
      </Head>
      <main className="page" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px 80px" }}>
        <p className="help-text">
          <Link href="/">← Home</Link>
        </p>
        <h1 style={{ marginBottom: 8 }}>Honest pricing</h1>
        <p className="help-text" style={{ maxWidth: 560 }}>
          Checkout is handled by Lemon Squeezy (merchant of record) — they collect payment and applicable
          sales tax/VAT. Catalog amounts below match what we charge before tax.
        </p>

        <section
          style={{
            margin: "28px 0",
            padding: "20px 22px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "linear-gradient(135deg, #f7f9fc 0%, #eef3fb 100%)",
          }}
        >
          <h2 className="text-display-sm" style={{ margin: "0 0 8px" }}>
            {PRICE_LOCK.headline}
          </h2>
          <p style={{ margin: 0, maxWidth: 640 }}>{PRICE_LOCK.body}</p>
          <p className="text-meta" style={{ marginTop: 10 }}>
            {PRICE_LOCK.footnote}
          </p>
        </section>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          }}
        >
          {plans.map((p) => (
            <article
              key={p.sku}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: 18,
                background: "var(--surface)",
              }}
            >
              <h3 style={{ margin: "0 0 6px" }}>{p.name}</h3>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: "1.35rem",
                  fontWeight: 700,
                  color: "var(--ink)",
                }}
              >
                {formatDisplayPrice(p.displayPriceCents, p.currency, p.interval)}
              </p>
              <p className="help-text" style={{ marginTop: 0, minHeight: 72 }}>
                {p.plainDescription}
              </p>
              <ul className="help-text" style={{ paddingLeft: 18, margin: "0 0 16px" }}>
                <li>
                  Events: {p.limits.activeEvents == null ? "Unlimited" : p.limits.activeEvents}
                </li>
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
                <Link className="button" href="/organizer">
                  Start free
                </Link>
              ) : (
                <Link className="button" href="/organizer/billing">
                  Upgrade in app
                </Link>
              )}
            </article>
          ))}
        </div>

        <p className="text-meta" style={{ marginTop: 28 }}>
          Tax note: Lemon Squeezy adds applicable sales tax/VAT at checkout where required. Displayed
          catalog prices are the pre-tax amounts from our plan config.
        </p>
      </main>
    </>
  );
}
