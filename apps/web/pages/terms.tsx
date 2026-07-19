import { brand } from "@event-app/config";
import Head from "next/head";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/** Placeholder — full ToS lands in Chunk B. */
export default function TermsPage() {
  const title = `Terms of Service — ${brand.productName}`;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={`Terms of Service for ${brand.productName} (draft).`} />
        <link rel="canonical" href={`${brand.primaryUrl}/terms`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 720 }}>
            <p className="mkt-draft-banner">DRAFT — requires legal review</p>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Terms of Service
            </h1>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              Full terms for {brand.legalEntity} will be published here. Support hours: {brand.supportHours}
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
