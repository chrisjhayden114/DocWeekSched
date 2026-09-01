import { brand, marketingSeo } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";

/**
 * /compare/whova (Chunk E27). Body copy is founder-approved verbatim from
 * docs/marketing-drafts/readyhall-vs-whova.md — edit the draft, get it approved,
 * then mirror the change here. SEO strings live in marketingSeo (config).
 */

/** Bump when the competitor facts are re-verified. Not the render date. */
const COMPETITOR_VERIFIED = "August 2026";

export default function CompareWhovaPage() {
  const title = marketingSeo.pages.compareWhova.title;
  const description = marketingSeo.pages.compareWhova.description;
  const url = `${brand.primaryUrl}/compare/whova`;

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
            <h1>{brand.productName} vs Whova: calm software or an engagement platform?</h1>
            <p className="text-meta">Competitor details verified {COMPETITOR_VERIFIED}.</p>

            <p>
              Whova is the feature-maximal event platform: networking gamification, leaderboards,
              sponsor tools, an app for everything. Plenty of events want exactly that. Academic
              conferences usually do not — and their attendees actively resent it. This page is the
              honest comparison for organizers of scholarly and education events.
            </p>

            <h2>The short version</h2>
            <p>
              Choose <strong>Whova</strong> if engagement mechanics are the point: leaderboards,
              contests, sponsor activations, an exhibitor hall.
            </p>
            <p>
              Choose <strong>{brand.productName}</strong> if your attendees are colleagues who want
              the programme, their own schedule, and quiet — with networking there when they want
              it, not forced on everyone — and you want to know the price without a sales call.
            </p>

            <h2>What&apos;s genuinely different</h2>
            <p>
              <strong>1. You can see our prices.</strong>
              <br />
              Whova is quote-based: pricing requires a sales conversation, plus (as of 2026) around
              3% + $0.99 per paid ticket, with organizers reporting add-on costs in the low thousands
              and unadvertised renewal increases. {brand.productName}&apos;s full price list is
              public at <Link href="/pricing">{brand.domain}/pricing</Link>: free tier, $79/month
              Pro, one-time per-event plans from $149. A department administrator can budget without
              emailing anyone.
            </p>
            <p>
              <strong>2. Notifications are opt-in and budgeted, not a firehose.</strong>
              <br />
              Whova&apos;s most consistent attendee complaint is notification volume.{" "}
              {brand.productName} is digest-first by design: there is a hard per-event budget on
              interrupting notifications, quiet hours are respected, and there are no auto-generated
              &quot;X viewed your profile&quot; touches. This is positioning, not a missing feature.
            </p>
            <p>
              <strong>3. Academic structure is the data model, not a workaround.</strong>
              <br />
              Papers and presentations nested in sessions with ordered authors or presenters, plus
              discussants; CFP with review and decisions; certificates; per-session
              in-person/virtual/async attendance. Whova is broader; for the specific shape of a
              scholarly programme, {brand.productName} is deeper.
            </p>
            <p>
              <strong>4. Programme import.</strong>
              <br />
              Upload the PDF or Word programme you already have; the AI drafts sessions, papers,
              presentations, authors, rooms and tracks for your review. Whova&apos;s strongest academic asset is
              direct HotCRP/OpenReview import — if your workflow lives in HotCRP, that is a genuine
              point in Whova&apos;s favour.
            </p>
            <p>
              <strong>5. No app store.</strong>
              <br />
              {brand.productName} is a fast web app: attendees tap a link. (Whova also offers web
              access now, so evaluate the <em>quality</em> of each, not the checkbox.)
            </p>
            <p>
              <strong>6. Connection without the coercion.</strong>
              <br />
              {brand.productName} does have networking — meet-ups, a photo feed, icebreakers, and posts
              you can target to a session or track. The difference is they&apos;re opt-in and
              organizer-controlled, off by default, and they respect the same notification budget and
              quiet hours. Whova&apos;s engagement is always-on and gamified; ours is there when you want
              it, quiet when you don&apos;t.
            </p>

            <h2>Speaker Readiness</h2>
            <p>
              {brand.productName} sends each presenter a personal link — no account, no login. They
              upload; you approve or reject. Reminders go out at 7 days, 2 days, and once when
              overdue. Whova has speaker forms; it does not chase presenters for you. If forms
              without automatic reminders are enough, pick Whova.
            </p>

            <h2>Honest reasons to pick Whova instead</h2>
            <ul>
              <li>
                You need <strong>full exhibitor booths</strong> — a dedicated hall, not just sponsor
                pages and lead capture — today.
              </li>
              <li>
                Your submission pipeline is <strong>HotCRP/OpenReview</strong> and that import
                matters.
              </li>
              <li>Your event thrives on engagement mechanics and contests.</li>
              <li>
                You want built-in registration/ticketing — {brand.productName} publishes fee info,
                payment links, and PO/check instructions and tracks who has paid, but does not
                process payments itself. Pick Whova if you need built-in payment processing.
              </li>
            </ul>

            <h2>The philosophical difference, plainly</h2>
            <p>
              Whova makes engagement the product — always-on and gamified. We make the calm
              conference the product, with networking available when you want it, never forced on
              everyone. Those genuinely are different products. Pick the one that matches what your
              attendees thank you for afterwards.
            </p>

            <p className="text-meta" style={{ marginTop: 32 }}>
              Also compare: <Link href="/compare/sched">{brand.productName} vs Sched</Link>
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
