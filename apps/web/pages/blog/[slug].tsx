import { brand, marketingBlogPostTitle } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";
import { getPost, listPosts, type BlogPost } from "../../lib/blog/blogContent";
import { serializeJsonLd } from "../../lib/jsonLd";

type Props = { post: BlogPost };

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: listPosts().map((post) => ({ params: { slug: post.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const slug = typeof ctx.params?.slug === "string" ? ctx.params.slug : "";
  const post = getPost(slug);
  if (!post) return { notFound: true };
  return { props: { post } };
};

export default function BlogPostPage({ post }: Props) {
  const title = marketingBlogPostTitle(post.title);
  const url = `${brand.primaryUrl}/blog/${post.slug}`;
  const ogImage = `${brand.primaryUrl}${brand.assets.ogImage}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    image: ogImage,
    author: { "@type": "Person", name: "Chris Hayden" },
    publisher: {
      "@type": "Organization",
      name: brand.productName,
      logo: {
        "@type": "ImageObject",
        url: `${brand.primaryUrl}${brand.assets.logo}`,
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={post.description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={post.description} />
        <link rel="canonical" href={url} />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main>
          <section className="mkt-section">
            <article className="mkt-section-inner mkt-prose mkt-legal">
              <p className="text-meta" style={{ marginTop: 0 }}>
                <Link href="/blog">Blog</Link>
                {" / "}
                {post.title}
              </p>
              <h1>{post.title}</h1>
              <p className="text-meta mkt-blog-byline">
                By {post.author}, {post.dateLabel}
              </p>
              <div
                className="help-article-body"
                // Repo-authored post markdown compiled to HTML — not user input.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
              />
              <p className="text-meta" style={{ marginTop: 32 }}>
                <Link href="/blog">← All posts</Link>
              </p>
            </article>
          </section>

          <section className="mkt-section mkt-cta-band">
            <div className="mkt-section-inner mkt-cta-band-inner">
              <h2 className="mkt-h2" style={{ marginBottom: 8 }}>
                Retire the chase at your next event.
              </h2>
              <p className="mkt-standfirst" style={{ marginBottom: 20 }}>
                Speaker Readiness is included in every plan, Free included. Or look at a live event
                first, with no account needed.
              </p>
              <div className="mkt-hero-cta" style={{ marginBottom: 0 }}>
                <Link className="button" href="/speaker-readiness">
                  See Speaker Readiness
                </Link>
                <Link className="button secondary" href={`/e/${brand.demoEventSlug}`}>
                  Try the live demo
                </Link>
              </div>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
