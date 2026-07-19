import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/** Lightweight help seed — expanded in Phase S1 / Chunk C. */
export default function HelpPage() {
  const title = `Help — ${brand.productName}`;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={`Getting started with ${brand.productName}.`} />
        <link rel="canonical" href={`${brand.primaryUrl}/help`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 720 }}>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Help
            </h1>
            <h2 className="text-display-sm">Getting started</h2>
            <ol className="text-body-md">
              <li>
                <Link href="/login">Create an account</Link> and an organization.
              </li>
              <li>Create an event (or use Setup Copilot) and add sessions.</li>
              <li>Invite attendees and publish when ready.</li>
            </ol>
            <h2 className="text-display-sm">Attendee FAQ</h2>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              Open the link your organizer shared (<code>/e/…</code>), sign in, then use Agenda and My Schedule.
              No app download required.
            </p>
            <h2 className="text-display-sm">Contact</h2>
            <p className="text-body-md">
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
              <br />
              <span className="text-meta">{brand.supportHours}</span>
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
