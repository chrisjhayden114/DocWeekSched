import { brand } from "@event-app/config";
import type { GetServerSideProps } from "next";
import { helpArticlePaths } from "../lib/help/articles";

/**
 * Sitemap lists marketing pages + demo event + /help articles only.
 * Customer event slugs are NOT enumerated (opt-in indexing comes later).
 */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const base = brand.primaryUrl.replace(/\/$/, "");
  const paths = [
    "/",
    "/pricing",
    "/terms",
    "/privacy",
    "/security",
    "/help",
    ...helpArticlePaths(),
    `/e/${brand.demoEventSlug}`,
  ];
  const urls = paths
    .map(
      (path) => `  <url>
    <loc>${base}${path === "/" ? "/" : path}</loc>
  </url>`,
    )
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
