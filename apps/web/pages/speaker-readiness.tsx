import {
  brand,
  marketingSeo,
  readinessReminderCopy,
  speakerReadinessService,
  speakerReadinessServiceMailto,
} from "@event-app/config";
import { PLAN_BY_SKU } from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { serializeJsonLd } from "../lib/jsonLd";

const JOB_TODAY = [
  {
    title: "The spreadsheet with a “chased?” column",
    body: "I have kept a row per presenter, a date of the last nudge, and still had no way to see the pile at a glance.",
  },
  {
    title: "version-final-FINAL decks",
    body: "I have opened three files with that name and still not known which one would project.",
  },
  {
    title: "The volunteer who burns out doing it",
    body: "I have asked someone kind to own the chasing, and watched them run out of goodwill two weeks before the event.",
  },
] as const;

const STEPS = [
  {
    n: "1",
    title: "Define the requirements once",
    body: "Bios, slides, forms, agreements — you name them as a template and assign it. You do not rewrite the ask for every presenter.",
  },
  {
    n: "2",
    title: "Each presenter gets a personal link",
    body: "No account, no password, no app. They upload a file up to 250 MB, or paste a Canva or Google Slides link.",
  },
  {
    n: "3",
    title: "You approve, or ask for a change",
    body: "The dashboard shows only what’s missing. Approve what landed; request a revision when it didn’t.",
  },
] as const;

const REPLACES = [
  { title: "The spreadsheet", body: "The tracker with a chased column is the dashboard now." },
  { title: "The mail merge", body: "The reminder is written once, in the product, and sent on the cadence." },
  { title: "The shared drive folder", body: "Files land on the presenter, not in a folder named after last year’s event." },
  { title: "Your memory", body: "Who you nudged on Tuesday does not have to live in your head." },
] as const;

const LIMITS = [
  {
    title: "It will not write the bios",
    body: "Presenters still write. We collect, remind, and show you what’s missing.",
  },
  {
    title: "Portal links expire after 30 days",
    body: "A fresh link is one click. Older links keep working until their own expiry — a reminder does not revoke last week’s email.",
  },
  {
    title: "Reminders are polite, not enforcement",
    body: "Three moments: 7 days out, 2 days out, and once if overdue. Nobody is locked out for being late.",
  },
] as const;

/** Illustrative fixture for the on-page email mock — not a customer claim. */
const MOCK_EVENT = "Regional PD Day";
const MOCK_PRESENTER = "Jordan Lee";
const MOCK_ITEMS = [
  { label: "Short bio", due: readinessReminderCopy.itemDue("Mar 12, 2027") },
  { label: "Slides", due: readinessReminderCopy.itemDue("Mar 12, 2027") },
  { label: "Signed agreement", due: readinessReminderCopy.itemNoDue },
] as const;

/** Config quotes rates as display strings ("from $1,250"); schema.org wants a number. */
function offerPrice(price: string): string {
  return price.replace(/[^\d.]/g, "");
}

export default function SpeakerReadinessPage() {
  const title = marketingSeo.pages.speakerReadiness.title;
  const description = marketingSeo.pages.speakerReadiness.description;
  const url = `${brand.primaryUrl}/speaker-readiness`;
  const ogImage = `${brand.primaryUrl}/icons/icon-512.png`;
  const mailto = speakerReadinessServiceMailto();
  const ctaLabel = `Email ${brand.supportEmail} with your presenter count and event date`;
  const freePresenterCap = PLAN_BY_SKU.free.limits.readinessPresentersPerEvent;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Speaker Readiness",
    description,
    url,
    provider: {
      "@type": "Organization",
      name: brand.productName,
      url: brand.primaryUrl,
    },
    // The software ships with every plan; these offers are the concierge service.
    offers: speakerReadinessService.tiers.map((tier) => ({
      "@type": "Offer",
      name: `Concierge — ${tier.scale}`,
      price: offerPrice(tier.price),
      priceCurrency: "USD",
    })),
  };

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href={url} />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      </Head>

      <div className="mkt-page">
        <SiteHeader />
        <main>
          <section className="mkt-hero" aria-labelledby="sr-hero">
            <div className="mkt-hero-inner">
              <div className="mkt-hero-copy">
                <p className="mkt-eyebrow">Speaker Readiness</p>
                <h1 id="sr-hero" className="mkt-hero-headline mkt-hero-headline--wide">
                  The two months before your event, without the chasing.
                </h1>
                <p className="mkt-hero-sub">
                  Every presenter ready — bios, slides, forms, agreements — with nobody on your team
                  sending reminder emails. Included in every plan, Free included.
                </p>
                <div className="mkt-hero-cta">
                  <Link className="button" href="/login?intent=create-event">
                    Create your event
                  </Link>
                  <Link className="button secondary" href="/pricing">
                    Open pricing
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="sr-included">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">How you get it</p>
              <h2 id="sr-included" className="mkt-h2">
                Included in every plan. Switch it on yourself.
              </h2>
              <p className="mkt-standfirst">
                No add-on, no sales call, no email to unlock it.
              </p>
              <ul className="mkt-trust-list">
                <li>
                  <strong>Every plan has it.</strong> Free, per-event, Pro and Enterprise all include
                  Speaker Readiness.
                </li>
                <li>
                  <strong>Turn it on under Features.</strong> Open your event, go to the{" "}
                  <strong>Features</strong> tab, and enable{" "}
                  <strong>Speaker &amp; Session Readiness</strong>. The event grows a Readiness tab.
                </li>
                {freePresenterCap == null ? null : (
                  <li>
                    <strong>Free tracks up to {freePresenterCap} presenters per event.</strong> Paid
                    plans track your whole roster, however long it is.
                  </li>
                )}
              </ul>
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="sr-today">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">The job as it exists today</p>
              <h2 id="sr-today" className="mkt-h2">
                Inbox archaeology, eight weeks out
              </h2>
              <p className="mkt-standfirst">First person because I have done this job.</p>
              <div className="mkt-feature-trio">
                {JOB_TODAY.map((item) => (
                  <article key={item.title} className="mkt-feature-card">
                    <h3 className="mkt-feature-title">{item.title}</h3>
                    <p className="mkt-feature-body">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="sr-how">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">How it works, honestly</p>
              <h2 id="sr-how" className="mkt-h2">
                A template, a link, a dashboard of gaps
              </h2>
              <p className="mkt-standfirst">Three steps. You stay in control of every approval.</p>
              <ol className="mkt-steps">
                {STEPS.map((s) => (
                  <li key={s.n}>
                    <span className="mkt-step-n" aria-hidden>
                      {s.n}
                    </span>
                    <div>
                      <h3 className="mkt-feature-title">{s.title}</h3>
                      <p className="mkt-feature-body">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="sr-email">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">The actual reminder email</p>
              <h2 id="sr-email" className="mkt-h2">
                The email your team does not write
              </h2>
              <figure className="mkt-email" aria-label="Reminder email example">
                <div className="mkt-email-chrome" aria-hidden>
                  <span className="mkt-browser-dot" />
                  <span className="mkt-browser-dot" />
                  <span className="mkt-browser-dot" />
                  <span className="mkt-email-chrome-label">Inbox</span>
                </div>
                <div className="mkt-email-meta">
                  <p>
                    <span className="mkt-email-key">From</span>
                    {MOCK_EVENT} — {brand.productName}
                  </p>
                  <p>
                    <span className="mkt-email-key">To</span>
                    {MOCK_PRESENTER}
                  </p>
                  <p className="mkt-email-subject">
                    <span className="mkt-email-key">Subject</span>
                    {readinessReminderCopy.subjectDue(MOCK_EVENT)}
                  </p>
                </div>
                <div className="mkt-email-body">
                  <p>{readinessReminderCopy.greeting(MOCK_PRESENTER)}</p>
                  <p>{readinessReminderCopy.bodyDue(MOCK_EVENT)}</p>
                  <ul>
                    {MOCK_ITEMS.map((item) => (
                      <li key={item.label}>
                        {item.label} — {item.due}
                      </li>
                    ))}
                  </ul>
                  <p>
                    <span className="mkt-email-cta">{readinessReminderCopy.portalCta}</span>
                  </p>
                  <p>{readinessReminderCopy.linkExpiryNote}</p>
                  <p className="mkt-email-already">{readinessReminderCopy.alreadySent}</p>
                </div>
                <figcaption className="text-meta mkt-email-caption">
                  This is the exact email your presenters receive — at 7 days, 2 days, and once if
                  overdue. Nobody on your team writes it.
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="sr-exceptions">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Exception-first, with receipts</p>
              <h2 id="sr-exceptions" className="mkt-h2">
                See the five who are missing something
              </h2>
              <p className="mkt-standfirst">
                Not the hundred who aren&apos;t. The dashboard is a list of gaps, not a pile of
                attachments.
              </p>
              <ul className="mkt-trust-list">
                <li>
                  <strong>Exceptions, not a roll call.</strong> You open the view to the presenters
                  who still owe a bio, a deck, or a signature — and skip everyone who is done.
                </li>
                <li>
                  <strong>Every action lands in an audit trail.</strong> Invite, reminder, approval,
                  change request — a committee can see who did what, and when.
                </li>
              </ul>
              <figure className="mkt-screenshot">
                <img
                  className="mkt-screenshot-img"
                  src="/marketing/readiness-dashboard.png"
                  alt="Readiness dashboard: every presenter at a glance"
                  width={1744}
                  height={520}
                  loading="lazy"
                />
                <figcaption className="text-meta mkt-screenshot-caption">
                  See the five who are missing something — not the hundred who aren&apos;t.
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="sr-replaces">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">What it replaces</p>
              <h2 id="sr-replaces" className="mkt-h2">
                The honest list
              </h2>
              <ul className="mkt-trust-list">
                {REPLACES.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}.</strong> {item.body}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="sr-concierge">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">The concierge service</p>
              <h2 id="sr-concierge" className="mkt-h2">
                Want it done with you?
              </h2>
              <p className="mkt-standfirst">
                The software is already in your plan. This is my time: rates on the page, by scale,
                no quote gate.
              </p>
              <p className="mkt-feature-body" style={{ maxWidth: "40rem" }}>
                {speakerReadinessService.promise}
              </p>
              <ul className="mkt-trust-list">
                {speakerReadinessService.tiers.map((tier) => (
                  <li key={tier.id}>
                    <strong>
                      {tier.name} · {tier.scale}
                    </strong>{" "}
                    — {tier.price}
                    {tier.priceNote ? `, ${tier.priceNote}` : ""}
                  </li>
                ))}
              </ul>
              <div className="mkt-hero-cta" style={{ marginTop: 28, marginBottom: 0 }}>
                <a className="button" href={mailto}>
                  {ctaLabel}
                </a>
              </div>
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="sr-limits">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Limits, stated plainly</p>
              <h2 id="sr-limits" className="mkt-h2">
                What it will not do
              </h2>
              <div className="mkt-feature-trio">
                {LIMITS.map((item) => (
                  <article key={item.title} className="mkt-feature-card">
                    <h3 className="mkt-feature-title">{item.title}</h3>
                    <p className="mkt-feature-body">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-cta-band">
            <div className="mkt-section-inner mkt-cta-band-inner">
              <h2 className="mkt-h2" style={{ marginBottom: 8 }}>
                The two months before your event, without the chasing.
              </h2>
              <p className="mkt-standfirst" style={{ marginBottom: 20 }}>
                Create your event and switch Readiness on under Features. Want it done with you?
                Tell me your presenter count and event date and I&apos;ll reply.
              </p>
              <div className="mkt-hero-cta" style={{ marginBottom: 0 }}>
                <Link className="button" href="/login?intent=create-event">
                  Create your event
                </Link>
                <a className="button secondary" href={mailto}>
                  {ctaLabel}
                </a>
              </div>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
