import { brand } from "@event-app/config";
import Head from "next/head";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";

/** Placeholder — full privacy policy lands in Chunk B. */
export default function PrivacyPage() {
  const title = `Privacy Policy — ${brand.productName}`;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={`Privacy Policy for ${brand.productName} (draft).`} />
        <link rel="canonical" href={`${brand.primaryUrl}/privacy`} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 720 }}>
            <p className="mkt-draft-banner">DRAFT — requires legal review</p>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Privacy Policy
            </h1>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              Subprocessors (preview): {brand.subprocessors.map((s) => s.name).join(", ")}. Contact{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
