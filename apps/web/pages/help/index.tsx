import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { SiteFooter } from "../components/marketing/SiteFooter";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { listHelpArticles, type HelpArticleMeta } from "../lib/help/articles";

type Props = { articles: HelpArticleMeta[] };

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  return { props: { articles: listHelpArticles() } };
};

export default function HelpIndexPage({ articles }: Props) {
  const title = `Help — ${brand.productName}`;
  const description = `Guides and FAQ for ${brand.productName} organizers and attendees.`;
  const url = `${brand.primaryUrl}/help`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="website" />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 720 }}>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              Help
            </h1>
            <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
              Markdown-driven guides for organizers and attendees. Full-text search arrives in a later
              release.
            </p>
            <ul className="text-body-md" style={{ paddingLeft: 20 }}>
              {articles.map((a) => (
                <li key={a.slug} style={{ marginBottom: 10 }}>
                  <Link href={`/help/${a.slug}`}>
                    <strong>{a.title}</strong>
                  </Link>
                  <div className="text-meta">{a.description}</div>
                </li>
              ))}
            </ul>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
