import { brand, marketingSeo } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";

/**
 * /compare/sched (Chunk E27). Body copy is founder-approved verbatim from
 * docs/marketing-drafts/readyhall-vs-sched.md — edit the draft, get it approved,
 * then mirror the change here. SEO strings live in marketingSeo (config).
 */

/** Bump when the competitor facts are re-verified. Not the render date. */
const COMPETITOR_VERIFIED = "August 2026";

export default function CompareSchedPage() {
  const title = marketingSeo.pages.compareSched.title;
  const description = marketingSeo.pages.compareSched.description;
  const url = `${brand.primaryUrl}/compare/sched`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content={brand.productName} />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <article className="mkt-section-inner mkt-prose mkt-legal">
            <h1>{brand.productName} vs Sched: which fits an academic conference?</h1>
            <p className="text-meta">Competitor details verified {COMPETITOR_VERIFIED}.</p>

            <p>
              Sched is good software. It has been the default &quot;just publish the schedule&quot; tool
              for a decade, and if you are running a film festival or a tech meetup it may be all you
              need. This page is about the specific case of <strong>academic and education
              conferences</strong> — sessions with papers and presentations, ordered authors, a CFP,
              and a programme that arrives as a PDF or Word document three weeks before show day.
            </p>

            <h2>The short version</h2>
            <p>
              Choose <strong>Sched</strong> if you want a mature, general-purpose schedule tool and
              your sessions are simple: one title, some speakers, a room.
            </p>
            <p>
              Choose <strong>{brand.productName}</strong> if your programme has <em>papers and
              presentations inside sessions</em> — author or presenter order that matters,
              discussants, a review process — or if your programme already exists as a document and
              you would rather not re-type it.
            </p>

            <h2>What&apos;s genuinely different</h2>
            <p>
              <strong>1. How your programme gets in.</strong>
              <br />
              In Sched, you build sessions one at a time or import a spreadsheet where one row equals
              one session and participants are joined in a single column. For a paper session with
              four papers and nine ordered authors, that model has nowhere to put the structure. In{" "}
              {brand.productName}, you upload the programme you already have — PDF, Word, Excel, CSV,
              or pasted text. The AI extracts sessions, papers, presentations, authors, rooms and
              tracks into a reviewable draft; nothing publishes until you approve it. A real 7-page
              programme becomes a reviewable 22-session draft in about two minutes.
            </p>
            <p>
              <strong>2. Papers and presentations as first-class records.</strong>
              <br />
              {brand.productName} models papers and presentations <em>inside</em> sessions with
              ordered authors or presenters and discussants — the parent/child structure academic
              programmes actually use. Sched&apos;s data model has no paper object; papers become
              text in a description field.
            </p>
            <p>
              <strong>3. Pricing.</strong>
              <br />
              Sched publishes prices (roughly $600–$3,900/year by tier, attendees counted in blocks —
              verify current figures at sched.com). {brand.productName}{" "}
              <Link href="/pricing">publishes prices</Link> too: free for events up to 50 attendees,
              $79/month Pro, or one-time per-event plans from $149. No sales call for either product —
              credit where due, Sched also sells self-serve.
            </p>
            <p>
              <strong>4. Calm by default; networking when you want it.</strong>
              <br />
              No engagement leaderboards, no push-notification campaigns, no attendee-data
              monetisation. {brand.productName} does include opt-in networking — meet-ups, a photo
              feed, icebreakers, targeted posts — but it&apos;s organizer-controlled, off by default,
              and never gamified. Academic attendees are colleagues, not an audience to activate. If
              gamification is what your event needs, neither we nor Sched are the tool — that&apos;s{" "}
              <Link href="/compare/whova">Whova&apos;s territory</Link>.
            </p>

            <h2>Speaker Readiness</h2>
            <p>
              {brand.productName} sends each presenter a personal link — no account, no login. They
              upload; you approve or reject. Reminders go out at 7 days, 2 days, and once when
              overdue. Sched requires speakers to create accounts and log in. If that account model
              is what you need, pick Sched.
            </p>

            <h2>Honest reasons to pick Sched instead</h2>
            <ul>
              <li>
                You need built-in <strong>payment processing</strong> — {brand.productName} publishes
                fee info, payment links, and PO/check instructions and tracks who has paid, but does
                not process payments itself. Pick Sched if you need built-in payment processing.
              </li>
              <li>Ten years of organizer muscle memory on your team.</li>
              <li>Your sessions genuinely are simple, and re-typing thirty of them is fine.</li>
            </ul>

            <h2>Try the difference</h2>
            <p>
              Paste your real programme into the demo at <Link href="/">{brand.domain}</Link> — the
              extraction runs in your browser against your actual document. If it doesn&apos;t save
              you an afternoon, use Sched with our blessing.
            </p>

            <p className="text-meta" style={{ marginTop: 32 }}>
              Also compare: <Link href="/compare/whova">{brand.productName} vs Whova</Link>
              {" · "}
              <Link href="/pricing">Pricing</Link>
              {" · "}
              <Link href="/">Paste your real programme into the demo</Link>
            </p>
          </article>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
