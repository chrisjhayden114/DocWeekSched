import { brand } from "@event-app/config";
import Head from "next/head";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/** Placeholder — full security page lands in Chunk B. */
export default function SecurityPage() {
  const title = `Security — ${brand.productName}`;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={`Security and trust information for ${brand.productName}.`} />
        <link rel="canonical" href={`${brand.primaryUrl}/security`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 720 }}>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Security
            </h1>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              Architecture summary, HECVAT Lite, and DPA downloads land in the next build chunk. Status:{" "}
              <a href={brand.statusPageUrl} rel="noopener noreferrer">
                {brand.statusPageUrl}
              </a>
              . Support hours: {brand.supportHours}
            </p>
            <ul className="text-body-md">
              <li>No ads</li>
              <li>No attendee-data monetization</li>
              <li>No engagement bait</li>
            </ul>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
