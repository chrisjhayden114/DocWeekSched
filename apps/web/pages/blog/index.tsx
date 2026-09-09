import { brand, marketingSeo } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetStaticProps } from "next";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";
import { listPosts, type BlogPostMeta } from "../../lib/blog/blogContent";

type Props = { posts: BlogPostMeta[] };

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: { posts: listPosts() },
});

export default function BlogIndexPage({ posts }: Props) {
  const title = marketingSeo.pages.blog.title;
  const description = marketingSeo.pages.blog.description;
  const url = `${brand.primaryUrl}/blog`;
  const ogImage = `${brand.primaryUrl}${brand.assets.ogImage}`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner mkt-prose">
            <p className="mkt-eyebrow">Blog</p>
            <h1>Notes on running calmer events</h1>
            <p>Field notes from an organizer who builds the tool.</p>
            <div className="mkt-blog-list">
              {posts.map((post) => (
                <article key={post.slug} className="mkt-blog-card">
                  <h2 className="mkt-blog-card-title">
                    <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>
                  <p className="text-meta mkt-blog-card-date">{post.dateLabel}</p>
                  <p className="mkt-feature-body">{post.description}</p>
                  <p className="mkt-blog-card-more">
                    <Link href={`/blog/${post.slug}`}>Read the post</Link>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
