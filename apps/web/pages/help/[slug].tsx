import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";
import { getHelpArticle, type HelpArticle } from "../../lib/help/articles";

type Props = { article: HelpArticle };

function applyBrandTokens(html: string): string {
  return html
    .replace(/\{\{product\}\}/g, brand.productName)
    .replace(/\{\{support\}\}/g, brand.supportEmail)
    .replace(/\{\{hours\}\}/g, brand.supportHours)
    .replace(/\{\{status\}\}/g, brand.statusPageUrl);
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const slug = typeof ctx.params?.slug === "string" ? ctx.params.slug : "";
  const article = getHelpArticle(slug);
  if (!article) return { notFound: true };
  return {
    props: {
      article: {
        ...article,
        bodyHtml: applyBrandTokens(article.bodyHtml),
        bodyMarkdown: applyBrandTokens(article.bodyMarkdown),
        description: applyBrandTokens(article.description),
        title: applyBrandTokens(article.title),
      },
    },
  };
};

export default function HelpArticlePage({ article }: Props) {
  const title = `${article.title} — ${brand.productName}`;
  const url = `${brand.primaryUrl}/help/${article.slug}`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={article.description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={article.description} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="article" />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <article className="mkt-section-inner mkt-legal" style={{ maxWidth: 720 }}>
            <p className="text-meta" style={{ marginTop: 0 }}>
              <Link href="/help">Help</Link> / {article.title}
            </p>
            <div
              className="help-article-body text-body-md"
              dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
            />
            <p className="text-meta" style={{ marginTop: 32 }}>
              <Link href="/help">← All articles</Link>
              {" · "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
            </p>
          </article>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
