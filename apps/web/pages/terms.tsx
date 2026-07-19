import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/**
 * Terms of Service — adapted from common SaaS ToS patterns (e.g. Termly / Stripe-style structure).
 * DRAFT — requires attorney review before launch. Not legal advice.
 */
export default function TermsPage() {
  const title = `Terms of Service — ${brand.productName}`;
  const updated = "18 July 2026";

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={`Terms of Service for ${brand.productName} (draft).`} />
        <meta property="og:title" content={title} />
        <link rel="canonical" href={`${brand.primaryUrl}/terms`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <article className="mkt-section-inner mkt-legal" style={{ maxWidth: 720 }}>
            <p className="mkt-draft-banner" role="status">
              DRAFT — requires legal review
            </p>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Terms of Service
            </h1>
            <p className="text-meta">
              Last updated: {updated}. Operated by {brand.legalEntity} (&quot;we&quot;, &quot;us&quot;) at{" "}
              {brand.domain}. Contact:{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
            </p>

            <h2 className="text-display-sm">1. Agreement</h2>
            <p>
              By creating an account or using {brand.productName}, you agree to these Terms. If you use the
              service on behalf of an organization, you represent that you have authority to bind that
              organization.
            </p>

            <h2 className="text-display-sm">2. The service</h2>
            <p>
              {brand.productName} provides event workspace software (scheduling, attendee tools, organizer
              features, and related AI-assisted drafting tools). Features depend on your plan and on
              per-event settings you configure. We may change or discontinue features with reasonable notice
              where practical.
            </p>

            <h2 className="text-display-sm">3. Accounts and organizers</h2>
            <p>
              You are responsible for safeguarding credentials and for activity under your account.
              Organizers are responsible for the events they create, the content they publish, and the
              attendees they invite. You must not abuse the service, probe others&apos; data, or violate
              applicable law.
            </p>

            <h2 className="text-display-sm">4. Plans, billing, and merchant of record</h2>
            <p>
              Paid plans are billed through our merchant of record (Lemon Squeezy). Taxes and refunds follow
              their checkout and policies. Public pricing is listed at{" "}
              <Link href="/pricing">/pricing</Link>. Hitting a plan limit shows an upgrade prompt; we do not
              silently fail critical actions.
            </p>

            <h2 className="text-display-sm">5. Support hours and event-day policy</h2>
            <p>
              <strong>Support hours:</strong> {brand.supportHours}
            </p>
            <p>
              We do <strong>not</strong> promise 24/7 live human support. On event days we provide{" "}
              <strong>best-effort</strong> assistance during support hours, plus automated resilience
              (status page, read-only degradation when available). For live incidents, check{" "}
              <a href={brand.statusPageUrl} rel="noopener noreferrer">
                {brand.statusPageUrl}
              </a>{" "}
              and email {brand.supportEmail}.
            </p>

            <h2 className="text-display-sm">6. Acceptable use and AI features</h2>
            <p>
              AI features draft content for your review. You remain responsible for what you publish or send.
              Do not use the service to spam attendees, scrape personal data, or circumvent security or plan
              limits.
            </p>

            <h2 className="text-display-sm">7. Data, privacy, and roles</h2>
            <p>
              Our <Link href="/privacy">Privacy Policy</Link> describes how we process personal data. For
              attendee data inside an event, the organizer is typically the controller and{" "}
              {brand.legalEntity} is the processor — see the privacy policy for details.
            </p>

            <h2 className="text-display-sm">8. Intellectual property</h2>
            <p>
              We own {brand.productName} and its software. You retain rights to content you upload. You grant
              us a limited license to host and process that content solely to operate the service.
            </p>

            <h2 className="text-display-sm">9. Disclaimers and limitation of liability</h2>
            <p>
              The service is provided &quot;as is&quot; to the extent permitted by law. We do not warrant
              uninterrupted or error-free operation. To the maximum extent permitted by law, our aggregate
              liability arising from these Terms is limited to the fees you paid us for the service in the
              twelve months before the claim (or USD $100 if you are on a free plan).
            </p>

            <h2 className="text-display-sm">10. Termination</h2>
            <p>
              You may stop using the service at any time. We may suspend or terminate accounts that breach
              these Terms or create risk to the service or other users. Export and deletion rights are
              described in the Privacy Policy and in-product account tools.
            </p>

            <h2 className="text-display-sm">11. Changes</h2>
            <p>
              We may update these Terms. Material changes will be posted on this page with an updated date.
              Continued use after the effective date constitutes acceptance.
            </p>

            <h2 className="text-display-sm">12. Contact</h2>
            <p>
              {brand.legalEntity}
              <br />
              {brand.domain}
              <br />
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
            </p>
          </article>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
