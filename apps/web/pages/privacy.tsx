import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { ProseToc } from "../components/marketing/ProseToc";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/**
 * Privacy Policy — adapted from common SaaS privacy templates.
 * DRAFT — requires attorney review. Subprocessors come from brand.subprocessors (config), never hardcoded names in JSX beyond map.
 *
 * Cookie consent: brand.cookieConsentRequired is false. We use essential session/CSRF cookies only;
 * no non-essential analytics cookies today. Revisit when S3 adds analytics cookies that require consent.
 */
const TOC = [
  { id: "who", label: "Who we are" },
  { id: "roles", label: "Controller and processor" },
  { id: "data", label: "Data we process" },
  { id: "why", label: "Why we process data" },
  { id: "subprocessors", label: "Subprocessors" },
  { id: "cookies", label: "Cookies" },
  { id: "retention", label: "Retention" },
  { id: "rights", label: "Your rights" },
  { id: "transfers", label: "International transfers" },
  { id: "security", label: "Security" },
  { id: "children", label: "Children" },
  { id: "contact", label: "Changes and contact" },
] as const;

export default function PrivacyPage() {
  const title = `Privacy Policy — ${brand.productName}`;
  const description = `Privacy Policy for ${brand.productName} (draft).`;
  const updated = "18 July 2026";
  const url = `${brand.primaryUrl}/privacy`;

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
            <p className="mkt-draft-banner" role="status">
              DRAFT — requires legal review
            </p>
            <h1>Privacy Policy</h1>
            <p className="text-meta">
              Last updated: {updated}. Controller for platform account data: {brand.legalEntity}. Contact:{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>. Website: {brand.domain}.
            </p>

            <ProseToc items={[...TOC]} />

            <h2 id="who">1. Who we are</h2>
            <p>
              {brand.productName} is operated by {brand.legalEntity}. This policy explains how we process
              personal data when you visit {brand.domain}, create an account, or use the product.
            </p>

            <h2 id="roles">2. Controller and processor roles</h2>
            <p>
              <strong>Organizers are controllers</strong> of personal data they collect about their
              attendees and speakers inside their events (for example registrations, agendas, messages, and
              check-ins for that event). <strong>{brand.legalEntity} is the processor</strong> for that
              event data: we process it on the organizer&apos;s instructions to provide {brand.productName}.
            </p>
            <p>
              For your {brand.productName} <em>account</em> (login, billing contact, support tickets with us),{" "}
              {brand.legalEntity} is the controller.
            </p>

            <h2 id="data">3. Data we process</h2>
            <ul>
              <li>Account profile: name, email, password hash, optional bio/affiliation/photo</li>
              <li>Organization and event membership roles</li>
              <li>Event participation: attendance, bookmarks, check-ins, messages you send</li>
              <li>Billing metadata via our merchant of record (not full card numbers on our servers)</li>
              <li>Technical logs needed to operate and secure the service (without storing secrets in logs)</li>
            </ul>

            <h2 id="why">4. Why we process data</h2>
            <p>
              To provide the service, authenticate you, enforce plans and security, send transactional email
              (invites, password reset, verification), improve reliability, and comply with law. We do not
              sell attendee data or show ads.
            </p>

            <h2 id="subprocessors">5. Subprocessors</h2>
            <p>We use the following subprocessors to operate {brand.productName}:</p>
            <ul>
              {brand.subprocessors.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> — {s.role}
                </li>
              ))}
            </ul>

            <h2 id="cookies">6. Cookies</h2>
            <p>
              We set <strong>essential</strong> cookies only: an HttpOnly session cookie for authentication
              and a CSRF cookie to protect state-changing requests.{" "}
              {brand.cookieConsentRequired
                ? "A consent banner is shown for non-essential cookies."
                : "Because we do not set non-essential analytics or advertising cookies today, we do not show a cookie consent banner. This is a deliberate product choice (see brand.cookieConsentRequired in config). If we add analytics cookies that require consent, we will enable a banner and update this section."}
            </p>

            <h2 id="retention">7. Retention</h2>
            <p>
              We retain account and event data while your account or organization remains active, and for a
              limited period afterward for backups, dispute resolution, and legal obligations. Organizers
              control how long they keep event content they are responsible for.
            </p>

            <h2 id="rights">8. Your rights (including GDPR)</h2>
            <p>
              Depending on your location, you may have rights to access, correct, export, or delete personal
              data. Signed-in users can download a JSON export of their own account data from{" "}
              <Link href="/account">Account</Link>. Deletion of accounts is available once cascade rules are
              finalized (see /security for continuity commitments). Organizer-held lists outside{" "}
              {brand.productName} remain the organizer&apos;s responsibility.
            </p>

            <h2 id="transfers">9. International transfers</h2>
            <p>
              Infrastructure may be located in the United States or other regions used by our hosting
              subprocessors. Where required, we rely on appropriate transfer mechanisms offered by those
              providers.
            </p>

            <h2 id="security">10. Security</h2>
            <p>
              See our <Link href="/security">Security</Link> page for architecture, downloads, and product
              principles. No method of transmission or storage is 100% secure.
            </p>

            <h2 id="children">11. Children</h2>
            <p>
              {brand.productName} is not directed to children under 16. If you believe we have collected such
              data in error, contact {brand.supportEmail}.
            </p>

            <h2 id="contact">12. Changes and contact</h2>
            <p>
              We may update this policy; the date above will change. Questions:{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a> ({brand.legalEntity}).
            </p>
          </article>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
