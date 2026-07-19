import { brand } from "@event-app/config";
import Head from "next/head";
import type { GetServerSideProps } from "next";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { HeroIngestDemo } from "../components/marketing/HeroIngestDemo";
import { homeEventQueryRedirect } from "../lib/entryRedirects";

type Props = Record<string, never>;

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const target = homeEventQueryRedirect(ctx.query.event);
  if (target) {
    return {
      redirect: {
        destination: target,
        permanent: false, // 302 — temporary
      },
    };
  }
  return { props: {} };
};

const FEATURES = [
  {
    title: "Paste your program. Your event is live.",
    body: "Upload a PDF or paste a schedule — Agenda Ingest drafts sessions and papers for you to review before anything goes public.",
  },
  {
    title: "Your attendees will thank you.",
    body: "Calm by design: digest-first notifications, quiet hours, and no engagement bait. Attendees get a useful agenda without the noise.",
  },
  {
    title: "Built for events that happen every year.",
    body: "Event Series remembers structure across editions, and the recurring-event price lock keeps next year’s rate predictable.",
  },
  {
    title: "Academic-grade where it counts.",
    body: "Paper-level session items, author ordering, CFP with blind review, certificates, and async as a first-class attendance mode.",
  },
  {
    title: "Honest pricing, honest uptime.",
    body: "Public plan matrix, published support hours, and a status page you can actually check at 3 a.m.",
  },
] as const;

const FAQ = [
  {
    q: "Do attendees need to download an app?",
    a: "No. The web app installs as a PWA when they want offline access — no app-store gate.",
  },
  {
    q: "Can I try it without signing up?",
    a: `Yes — open the public demo at /e/${brand.demoEventSlug}.`,
  },
  {
    q: "What counts as an attendee?",
    a: "Anyone invited or joined for an event counts toward your plan’s attendee cap for that event.",
  },
] as const;

export default function LandingPage() {
  const title = `${brand.productName} — Paste your program. Your event is live.`;
  const description =
    "Calm, AI-native event workspace for recurring conferences and academic programs. Agenda ingest, quiet notifications, and honest pricing.";
  const ogImage = `${brand.primaryUrl}/icons/icon-512.png`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={brand.primaryUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href={brand.primaryUrl} />
      </Head>

      <div className="mkt-page">
        <SiteHeader />
        <main>
          <section className="mkt-hero" aria-labelledby="mkt-hero-brand">
            <div className="mkt-hero-inner">
              <p id="mkt-hero-brand" className="mkt-hero-brand">
                {brand.productName}
              </p>
              <h1 className="mkt-hero-headline">Paste your program. Your event is live.</h1>
              <p className="mkt-hero-sub">
                Turn an uploaded agenda into a calm, publishable event in minutes — without notification spam or sales-call pricing.
              </p>
              <div className="mkt-hero-cta">
                <a className="button" href="/login">
                  Start free
                </a>
                <a className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                  Try the demo
                </a>
              </div>
              <HeroIngestDemo />
            </div>
          </section>

          {FEATURES.map((f) => (
            <section key={f.title} className="mkt-section">
              <div className="mkt-section-inner">
                <h2 className="text-display-md" style={{ marginTop: 0 }}>
                  {f.title}
                </h2>
                <p className="text-body-lg" style={{ color: "var(--ink-secondary)", maxWidth: 560, marginBottom: 0 }}>
                  {f.body}
                </p>
              </div>
            </section>
          ))}

          <section className="mkt-section mkt-section--alt" id="pricing-teaser">
            <div className="mkt-section-inner">
              <h2 className="text-display-md" style={{ marginTop: 0 }}>
                Honest pricing
              </h2>
              <p className="text-body-lg" style={{ color: "var(--ink-secondary)", maxWidth: 520 }}>
                Transparent plan matrix, recurring-event price lock, no sales-call gate.
              </p>
              <a className="button" href="/pricing">
                See plans
              </a>
            </div>
          </section>

          <section className="mkt-section" id="faq">
            <div className="mkt-section-inner">
              <h2 className="text-display-md" style={{ marginTop: 0 }}>
                FAQ
              </h2>
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
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
