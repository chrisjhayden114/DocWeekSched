import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

export default function SecurityPage() {
  const title = `Security — ${brand.productName}`;
  const description = `Security architecture, downloads, and product principles for ${brand.productName}.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <link rel="canonical" href={`${brand.primaryUrl}/security`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <article className="mkt-section-inner mkt-legal" style={{ maxWidth: 720 }}>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Security
            </h1>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              How {brand.legalEntity} operates {brand.productName} for organizers who need trustworthy
              uptime and honest capability claims.
            </p>

            <h2 className="text-display-sm">Architecture summary</h2>
            <ul>
              <li>
                <strong>Managed infrastructure.</strong> Web on Netlify, API on Render, PostgreSQL on Neon —
                listed as subprocessors in our <Link href="/privacy">Privacy Policy</Link>.
              </li>
              <li>
                <strong>Transport security.</strong> TLS for all public HTTPS endpoints.
              </li>
              <li>
                <strong>Encryption at rest.</strong> Provided by our managed database and host providers
                (Neon / Render / Netlify class controls).
              </li>
              <li>
                <strong>Authentication.</strong> Session cookies (HttpOnly, Secure in production, SameSite)
                with CSRF protection on cookie-authenticated writes. Passwords are hashed; secrets are not
                logged.
              </li>
              <li>
                <strong>Tenancy.</strong> Event and organization data access is scoped server-side; new
                endpoints ship with authorization tests.
              </li>
              <li>
                <strong>Backups and restore drills.</strong> Database backups are retained via the managed
                Postgres provider. We schedule restore drills as part of solo-ops hardening (documented in
                RUNBOOK when Phase S2 lands). Continuity goal: recover agenda-critical reads if writes are
                impaired.
              </li>
            </ul>

            <h2 className="text-display-sm">Status</h2>
            <p>
              Public status page:{" "}
              <a href={brand.statusPageUrl} rel="noopener noreferrer">
                {brand.statusPageUrl}
              </a>{" "}
              (placeholder until the S2 provider is wired). Support hours: {brand.supportHours}
            </p>

            <h2 className="text-display-sm">Downloads</h2>
            <p className="mkt-draft-banner" role="status">
              DRAFT — requires legal / security review
            </p>
            <ul>
              <li>
                <a href="/legal/hecvat-lite.pdf" download>
                  HECVAT Lite (PDF)
                </a>{" "}
                — higher-ed vendor questionnaire lite pack (placeholder draft).
              </li>
              <li>
                <a href="/legal/dpa.pdf" download>
                  Data Processing Agreement (PDF)
                </a>{" "}
                — DPA for organizers (placeholder draft).
              </li>
            </ul>

            <h2 className="text-display-sm">Data export and continuity</h2>
            <p>
              Signed-in users can export their own account data as JSON from{" "}
              <Link href="/account">Account</Link> (profile, memberships, attendance, and message metadata).
              We do not hold attendee data hostage: organizers can export event tables from the product, and
              account deletion cascade rules will be published once approved. During incidents we aim for
              read-only degradation so schedules remain available.
            </p>

            <h2 className="text-display-sm">Product principles (anti-goals)</h2>
            <ul>
              {brand.productPrinciples.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="text-meta">
              These are deliberate non-goals from our product strategy — we will not &quot;helpfully&quot; add
              them later.
            </p>

            <h2 className="text-display-sm">Report a vulnerability</h2>
            <p>
              Email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>. See also{" "}
              <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
            </p>
          </article>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
