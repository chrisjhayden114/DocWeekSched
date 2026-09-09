import { brand } from "@event-app/config";
import type { GetServerSideProps } from "next";
import { listPosts } from "../lib/blog/blogContent";
import { helpArticlePaths } from "../lib/help/articles";

/**
 * Sitemap lists marketing pages + demo event + /help articles + /blog posts.
 * Customer event slugs are NOT enumerated (opt-in indexing comes later).
 *
 * Only blog URLs carry <lastmod>: a post has a publication date worth telling
 * a crawler about, while the marketing pages have no honest date to give.
 */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const base = brand.primaryUrl.replace(/\/$/, "");
  const posts = listPosts();
  const entries: { path: string; lastmod?: string }[] = [
    "/",
    "/pricing",
    "/terms",
    "/privacy",
    "/security",
    "/speaker-readiness",
    "/compare/sched",
    "/compare/whova",
    "/help",
    "/help/feature-guide",
    ...helpArticlePaths(),
    `/e/${brand.demoEventSlug}`,
  ].map((path) => ({ path }));

  entries.push({ path: "/blog", ...(posts[0] ? { lastmod: posts[0].date } : {}) });
  for (const post of posts) {
    entries.push({ path: `/blog/${post.slug}`, lastmod: post.date });
  }

  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = `  <url>
    <loc>${base}${path === "/" ? "/" : path}</loc>`;
      return lastmod ? `${loc}\n    <lastmod>${lastmod}</lastmod>\n  </url>` : `${loc}\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.write(xml);
  res.end();
  return { props: {} };
};

export default function SitemapXml() {
  return null;
}
