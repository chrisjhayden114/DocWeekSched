import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { HeroIngestDemo } from "../components/marketing/HeroIngestDemo";
import { DemoScheduleFrame } from "../components/marketing/DemoScheduleFrame";
import { homeEventQueryRedirect } from "../lib/entryRedirects";

type Props = Record<string, never>;

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const target = homeEventQueryRedirect(ctx.query.event);
  if (target) {
    return {
      redirect: {
        destination: target,
        permanent: false,
      },
    };
  }
  return { props: {} };
};

const FEATURES = [
  {
    eyebrow: "Papers & authors",
    title: "Academic structure, first-class",
    body: "Sessions nest papers with author order preserved, discussants, and individual times — the parent/child model conference programs actually use.",
  },
  {
    eyebrow: "AI program ingest",
    title: "AI generated, always reviewable",
    body: "Upload a PDF or paste a schedule. Agenda Ingest proposes sessions and papers — nothing publishes until you confirm.",
  },
  {
    eyebrow: "Attendee experience",
    title: "Calm by design",
    body: "Digest-first notifications, quiet hours, and no engagement bait. Attendees get a scannable agenda without the noise.",
  },
] as const;

const STEPS = [
  {
    n: "1",
    title: "Paste or upload your program",
    body: "Bring a PDF, spreadsheet, or plain text. Ingest drafts the structure for review.",
  },
  {
    n: "2",
    title: "Edit tracks, rooms, and papers",
    body: "Tighten titles, assign rooms, keep author order. Publish when the draft is right.",
  },
  {
    n: "3",
    title: "Share the public schedule",
    body: "Attendees open a clean agenda, build My Schedule, and join without an app-store gate.",
  },
] as const;

export default function LandingPage() {
  const title = `${brand.productName} — Paste your program. Your event is live.`;
  const description =
    "Calm event workspace for academic programs and recurring conferences. Agenda ingest, first-class papers, quiet notifications, and open pricing.";
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
            <div className="mkt-hero-inner mkt-hero-grid">
              <div className="mkt-hero-copy">
                <p id="mkt-hero-brand" className="mkt-hero-brand">
                  {brand.productName}
                </p>
                <h1 className="mkt-hero-headline">Paste your program. Your event is live.</h1>
                <p className="mkt-hero-sub">
                  Turn an uploaded agenda into a calm, publishable event in minutes — without notification spam or
                  sales-call pricing.
                </p>
                <div className="mkt-hero-cta">
                  <Link className="button" href="/login?intent=create-event">
                    Create your event
                  </Link>
                  <Link className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                    Try the demo
                  </Link>
                </div>
              </div>
              <DemoScheduleFrame />
            </div>
          </section>

          <section className="mkt-section" aria-label="Try agenda ingest">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Interactive demo</p>
              <h2 className="mkt-h2">Extract a draft from a sample program</h2>
              <p className="mkt-standfirst">
                No account required. This runs entirely in your browser — a mock extract of the sample text below.
              </p>
              <HeroIngestDemo />
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" id="product">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Built for academic events</p>
              <h2 className="mkt-h2">What organizers actually need</h2>
              <p className="mkt-standfirst">
                Papers, authors, CFP, and series — treated as product, not afterthoughts.
              </p>
              <div className="mkt-feature-trio">
                {FEATURES.map((f) => (
                  <article key={f.title} className="mkt-feature-card">
                    <p className="mkt-eyebrow" style={{ marginBottom: 8 }}>
                      {f.eyebrow}
                    </p>
                    <h3 className="mkt-feature-title">{f.title}</h3>
                    <p className="mkt-feature-body">{f.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">How it works</p>
              <h2 className="mkt-h2">Three steps from program to published</h2>
              <p className="mkt-standfirst">Review every draft before attendees see it.</p>
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

          <section className="mkt-section mkt-section--alt" id="trust">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Trust</p>
              <h2 className="mkt-h2">What we publish as true</h2>
              <p className="mkt-standfirst">
                Specific product facts — not logos, testimonials, or invented user counts.
              </p>
              <ul className="mkt-trust-list">
                <li>
                  <strong>Open pricing.</strong> Public plan matrix on{" "}
                  <Link href="/pricing">/pricing</Link> — no sales-call gate for the catalog.
                </li>
                <li>
                  <strong>Data export.</strong> Organizers can export their event data; we do not hold agendas hostage.
                </li>
                {brand.productPrinciples.map((p) => (
                  <li key={p}>
                    <strong>{p}.</strong>
                  </li>
                ))}
                <li>
                  <strong>Security &amp; principles.</strong> Architecture notes, subprocessors, and the full list on{" "}
                  <Link href="/security">/security</Link>.
                </li>
              </ul>
            </div>
          </section>

          <section className="mkt-section mkt-cta-band">
            <div className="mkt-section-inner mkt-cta-band-inner">
              <h2 className="mkt-h2" style={{ marginBottom: 8 }}>
                Ready when your program is
              </h2>
              <p className="mkt-standfirst" style={{ marginBottom: 20 }}>
                Start free, or open the public demo schedule first.
              </p>
              <div className="mkt-hero-cta" style={{ marginBottom: 0 }}>
                <Link className="button" href="/login?intent=create-event">
                  Create your event
                </Link>
                <Link className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                  Open /e/{brand.demoEventSlug}
                </Link>
              </div>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
