import { brand, marketingSeo } from "@event-app/config";
import { formatDisplayPrice, PLAN_BY_SKU, publicPricingPlans } from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { HeroIngestDemo } from "../components/marketing/HeroIngestDemo";
import { DemoScheduleFrame } from "../components/marketing/DemoScheduleFrame";
import { homeEventQueryRedirect } from "../lib/entryRedirects";
import { serializeJsonLd } from "../lib/jsonLd";

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

const PROBLEMS = [
  {
    title: "Presenter-chasing email threads",
    body: "Slides, bios, and “just one more reminder” live in inboxes. Nobody can see what’s still missing.",
  },
  {
    title: "version-final-FINAL.xlsx",
    body: "The program of record is a spreadsheet with three conflicting copies, and attendees get whichever one was emailed last.",
  },
  {
    title: "No usable agenda on the day",
    body: "People arrive without a personal schedule — or they’re asked to download an app they’ll delete on Monday.",
  },
] as const;

const STEPS = [
  {
    n: "1",
    title: "Send, paste, or describe",
    body: "Excel, PDF, Word, pasted text — or describe the day. We draft the agenda from what you already have.",
  },
  {
    n: "2",
    title: "Review the draft",
    body: "The Assumptions panel shows what we inferred. Nothing publishes until you confirm.",
  },
  {
    n: "3",
    title: "Publish and share",
    body: "Attendees get the link the same day. When the program changes, the update takes minutes — not a new PDF.",
  },
] as const;

const SHAPES = [
  {
    eyebrow: "Academic conference",
    title: "Papers, authors, and a real CFP",
    body: "You're running papers and presentations with ordered authors, a blind-review CFP, and certificates — the structure scholarly programs actually use.",
    does: `${brand.productName} keeps that parent/child model in the data, not as a workaround.`,
  },
  {
    eyebrow: "School PD week",
    title: "400 teachers, 20 simultaneous workshops",
    body: "You're running a week of parallel sessions where each person picks one per block — and needs to see only their choice, not the whole grid.",
    does: `${brand.productName} gives a pick-one agenda view built for that shape.`,
  },
  {
    eyebrow: "Regional association",
    title: "A two-person secretariat, five countries",
    body: "You're running the event across timezones, with a branded site and no bench of ops staff.",
    does: `${brand.productName} handles timezone display and event branding so the secretariat isn't also the IT team.`,
  },
] as const;

const REST_OF_JOB = [
  { title: "CFP with blind review", body: "Call for papers, reviewers, and decisions — without a second tool." },
  { title: "Certificates", body: "Issue attendance or presentation certificates from the roster." },
  { title: "Badges", body: "Printable badges from the same participant list." },
  { title: "QR check-in", body: "Scan at the door; the roster updates." },
  { title: "Registration fees", body: "Publish price and payment instructions, track who's paid; POs and checks welcome." },
  { title: "Sponsors and lead capture", body: "Sponsor pages plus a scanner so leads aren't a paper pile." },
  { title: "Sponsor outreach", body: "Track prospects and send asks from your own inbox." },
  { title: "Analytics", body: "What filled, what didn't — after the fact, not a vanity dashboard." },
  { title: "Polls and surveys", body: "In-session polls and post-session feedback." },
  { title: "Venue maps", body: "Rooms on a map, linked from the session." },
  { title: "Announcements", body: "A budgeted channel — not a notification firehose." },
  { title: "Ops inbox", body: "Day-of questions in one place, not twelve group chats." },
  { title: "Post-event recap", body: "A recap drafted from what actually happened." },
] as const;

const CALM = [
  {
    title: "Per-event notification budget",
    body: "Interrupting notifications are capped per event. Quiet hours are respected.",
  },
  {
    title: "Quiet hours",
    body: "We don’t ping people at 11 p.m. because a session title changed.",
  },
  {
    title: "Networking off by default",
    body: "Meet-ups, photos, and directory features stay off until you turn them on.",
  },
  {
    title: "No leaderboards or streaks",
    body: "No points race, no “X viewed your profile.” Colleagues aren’t a game.",
  },
  {
    title: "Essential cookies only",
    body: "Session and CSRF. No analytics or advertising cookies.",
  },
  {
    title: "No ads, no data resale",
    body: "We don’t show ads and we don’t sell attendee data. Those are published product principles.",
  },
] as const;

const HOME_PLANS = [PLAN_BY_SKU.free, PLAN_BY_SKU.per_event_250, PLAN_BY_SKU.pro_monthly] as const;

const FAQ = [
  {
    q: "How accurate is the AI draft?",
    a: "You review it. The Assumptions panel lists what we inferred. Nothing goes live until you confirm — the draft is a starting point, not a publish.",
  },
  {
    q: "What if the program changes after we publish?",
    a: "Edit the session and save. Attendees see the update in minutes — no new PDF, no “please ignore the last version.”",
  },
  {
    q: "Where is my data, and can I leave?",
    a: "Export anytime from the product. Account deletion is real: you confirm, the account deactivates, and after a short grace period it’s permanently deleted. We don’t hold agendas hostage.",
  },
  {
    q: "Who are you?",
    a: "One educator who ran these events and built the tool. Support hours, export, deletion, and the status page are in the founder note on this page.",
    href: "#founder",
    linkLabel: "Read the founder note",
  },
  {
    q: "Do attendees need to download an app?",
    a: "No. They open a link in the browser — personal agendas, the pick-one breakout view, session details, and a grounded Event assistant that answers only from the published program.",
  },
] as const;

export default function LandingPage() {
  // Category-first title/description convert searchers; the hero H1 tagline below converts humans.
  const title = marketingSeo.pages.home.title;
  const description = marketingSeo.pages.home.description;
  const ogImage = `${brand.primaryUrl}${brand.assets.ogImage}`;

  // schema.org SoftwareApplication with offers straight from the plan catalog (E25.4).
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.productName,
    description: marketingSeo.categoryLine,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: brand.primaryUrl,
    offers: publicPricingPlans()
      .filter((p) => p.displayPriceCents != null)
      .map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: ((p.displayPriceCents ?? 0) / 100).toFixed(2),
        priceCurrency: p.currency.toUpperCase(),
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
        <meta property="og:url" content={brand.primaryUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href={brand.primaryUrl} />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(softwareJsonLd) }}
        />
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
                {/* The short tagline is the line under the wordmark; the longer
                    category descriptor still does its job in the footer, the
                    SEO strings, and the JSON-LD description above. Two small
                    lines stacked before the H1 read as boilerplate. */}
                <p className="text-meta" style={{ margin: "0 0 8px" }}>
                  {brand.shortTagline}
                </p>
                <h1 className="mkt-hero-headline">
                  Send, paste, or describe your program. Your event is live today.
                </h1>
                <p className="mkt-hero-sub">
                  Excel, PDF, Word, pasted text — or just describe the day and we draft an agenda. You review
                  everything before it publishes. And every presenter gets ready without you chasing them.
                </p>
                <div className="mkt-hero-cta">
                  <Link className="button" href="/login?intent=create-event">
                    Create your event
                  </Link>
                  <Link className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                    Try the live demo
                  </Link>
                </div>
              </div>
              <DemoScheduleFrame />
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="mkt-problem">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">The problem</p>
              <h2 id="mkt-problem" className="mkt-h2">
                The week before still looks like this
              </h2>
              <p className="mkt-standfirst">Three jobs that steal the run-up to the event.</p>
              <div className="mkt-feature-trio">
                {PROBLEMS.map((item) => (
                  <article key={item.title} className="mkt-feature-card">
                    <h3 className="mkt-feature-title">{item.title}</h3>
                    <p className="mkt-feature-body">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="mkt-how">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">How it works</p>
              <h2 id="mkt-how" className="mkt-h2">
                Three steps from program to published
              </h2>
              <p className="mkt-standfirst">You stay in control of every draft.</p>
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

          <section className="mkt-section mkt-section--alt" aria-labelledby="mkt-shape">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Built for education events</p>
              <h2 id="mkt-shape" className="mkt-h2">
                Built for your event&apos;s shape
              </h2>
              <p className="mkt-standfirst">
                Academic conferences, school PD days, and education associations — same product, different
                recognition.
              </p>
              <div className="mkt-feature-trio">
                {SHAPES.map((item) => (
                  <article key={item.eyebrow} className="mkt-feature-card">
                    <p className="mkt-eyebrow" style={{ marginBottom: 8 }}>
                      {item.eyebrow}
                    </p>
                    <h3 className="mkt-feature-title">{item.title}</h3>
                    <p className="mkt-feature-body">{item.body}</p>
                    <p className="mkt-feature-body" style={{ marginTop: 10 }}>
                      {item.does}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section" id="product" aria-labelledby="mkt-readiness">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Speaker Readiness</p>
              <h2 id="mkt-readiness" className="mkt-h2">
                Stop chasing speakers.
              </h2>
              <p className="mkt-standfirst">
                Define what each presenter owes once. Then the reminders — and the inbox — stop being your job.
              </p>
              <ul className="mkt-trust-list">
                <li>
                  <strong>One template.</strong> Bios, slides, AV needs — you name the requirements once and assign
                  them.
                </li>
                <li>
                  <strong>A personal link, not an account.</strong> Every presenter gets a link. No password, no
                  app, no “please create a login.”
                </li>
                <li>
                  <strong>Upload or paste a link.</strong> Slides up to 250 MB, or a Canva or Google Slides URL.
                </li>
                <li>
                  <strong>A dashboard of what’s missing.</strong> Approve or request changes. You see gaps, not a
                  pile of attachments.
                </li>
                <li>
                  <strong>Reminders you don’t send.</strong> Polite automatic emails at 7 days, 2 days, and once
                  when overdue — so nobody on your team has to write them.
                </li>
                <li>
                  <strong>In every plan, Free included.</strong> Turn it on under Features when you want it —
                  there is nothing to ask for.
                </li>
              </ul>
              <div className="mkt-hero-cta" style={{ marginTop: 28, marginBottom: 0 }}>
                <Link className="button" href="/speaker-readiness">
                  See Speaker Readiness
                </Link>
                <Link className="button secondary" href="/pricing">
                  Open pricing
                </Link>
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="mkt-attendees">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">For attendees</p>
              <h2 id="mkt-attendees" className="mkt-h2">
                What your attendees get
              </h2>
              <p className="mkt-standfirst">
                Sell them the day, not an app store listing. You&apos;re the one who shops this site; they get the
                event.
              </p>
              <ul className="mkt-trust-list">
                <li>
                  <strong>A browser app.</strong> They tap a link. No download.
                </li>
                <li>
                  <strong>Personal agendas.</strong> Each person keeps the sessions they chose.
                </li>
                <li>
                  <strong>The pick-one breakout view.</strong> Twenty workshops in a block — they pick one and the
                  rest recede.
                </li>
                <li>
                  <strong>Session details in one tap.</strong> Room, time, presenters, materials.
                </li>
                <li>
                  <strong>Timezone handling.</strong> Wall-clock times in the event zone, with a local-time toggle.
                </li>
                <li>
                  <strong>A grounded Event assistant.</strong> It answers only from the published program — not
                  from the open web.
                </li>
              </ul>
              <p style={{ margin: "24px 0 0" }}>
                <Link href={`/e/${brand.demoEventSlug}`}>Try the live demo</Link>
                {" — "}
                the same attendee app, no account.
              </p>
            </div>
          </section>

          <section className="mkt-section" aria-labelledby="mkt-rest">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Also in the product</p>
              <h2 id="mkt-rest" className="mkt-h2">
                The rest of the job
              </h2>
              <p className="mkt-standfirst">The surrounding work, one line each — not a feature wall.</p>
              <ul className="mkt-trust-list">
                {REST_OF_JOB.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}.</strong> {item.body}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" aria-labelledby="mkt-calm">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Calm by design</p>
              <h2 id="mkt-calm" className="mkt-h2">
                Promises with mechanisms
              </h2>
              <p className="mkt-standfirst">
                “Calm” is a product choice, not a tone of voice. Here’s what that means in the software.
              </p>
              <div className="mkt-feature-trio">
                {CALM.map((item) => (
                  <article key={item.title} className="mkt-feature-card">
                    <h3 className="mkt-feature-title">{item.title}</h3>
                    <p className="mkt-feature-body">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section" id="founder" aria-labelledby="mkt-founder">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">In the open</p>
              <h2 id="mkt-founder" className="mkt-h2">
                One educator, in the open
              </h2>
              <p className="mkt-standfirst">First person because it&apos;s true.</p>
              <ul className="mkt-trust-list">
                <li>
                  I&apos;m an educator. I&apos;ve spent years on the organizing side of PD days and regional
                  conferences — usually as the person turning a giant spreadsheet of parallel workshops into
                  something people could actually navigate, then chasing every presenter for slides. I built{" "}
                  {brand.productName} to do both jobs.
                </li>
                <li>
                  <strong>I&apos;m one person, not a sales team.</strong> There is no quote process and no
                  account executive. Support hours are honest: {brand.supportHours}
                </li>
                <li>
                  <strong>Continuity.</strong> Export anytime. Account deletion is real — confirm, deactivate,
                  then permanent deletion after a short grace period. Incidents are public on the{" "}
                  <a href={brand.statusPageUrl} rel="noopener noreferrer">
                    status page
                  </a>
                  .
                </li>
                <li>
                  Architecture, subprocessors, and the full list of product principles live on{" "}
                  <Link href="/security">/security</Link>.
                </li>
              </ul>
            </div>
          </section>

          <section className="mkt-section mkt-section--alt" id="pricing" aria-labelledby="mkt-pricing">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">Pricing, in public</p>
              <h2 id="mkt-pricing" className="mkt-h2">
                Budget without emailing anyone
              </h2>
              <p className="mkt-standfirst">
                No quote wall. Amounts come from the same catalog as checkout — full matrix on{" "}
                <Link href="/pricing">/pricing</Link>.
              </p>
              <div className="mkt-plan-grid">
                {HOME_PLANS.map((plan) => (
                  <article key={plan.sku} className="mkt-plan-card">
                    <h3>{plan.name}</h3>
                    <p className="mkt-plan-price">
                      {formatDisplayPrice(plan.displayPriceCents, plan.currency, plan.interval)}
                    </p>
                    <p className="mkt-feature-body" style={{ margin: 0 }}>
                      {plan.plainDescription}
                    </p>
                  </article>
                ))}
              </div>
              <p style={{ margin: "8px 0 0" }}>
                <Link href="/pricing">See every plan and the recurring-event price lock</Link>
              </p>
            </div>
          </section>

          <section className="mkt-section" id="faq" aria-labelledby="mkt-faq">
            <div className="mkt-section-inner">
              <p className="mkt-eyebrow">FAQ</p>
              <h2 id="mkt-faq" className="mkt-h2">
                Questions an organizer would ask
              </h2>
              <div className="mkt-faq">
                {FAQ.map((item) => (
                  <details key={item.q}>
                    <summary>{item.q}</summary>
                    <p>
                      {item.a}
                      {"href" in item && item.href ? (
                        <>
                          {" "}
                          <Link href={item.href}>{item.linkLabel}</Link>.
                        </>
                      ) : null}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          <section className="mkt-section mkt-cta-band">
            <div className="mkt-section-inner mkt-cta-band-inner">
              <h2 className="mkt-h2" style={{ marginBottom: 8 }}>
                Send, paste, or describe your program. Your event is live today.
              </h2>
              <p className="mkt-standfirst" style={{ marginBottom: 20 }}>
                Excel, PDF, Word, pasted text — or just describe the day. You review everything before it
                publishes.
              </p>
              <div className="mkt-hero-cta" style={{ marginBottom: 0 }}>
                <Link className="button" href="/login?intent=create-event">
                  Create your event
                </Link>
                <Link className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                  Try the live demo
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
