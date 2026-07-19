import { brand } from "@event-app/config";
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const base = brand.primaryUrl.replace(/\/$/, "");
  const body = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /
Allow: /pricing
Allow: /terms
Allow: /privacy
Allow: /security
Allow: /help
Allow: /e/${brand.demoEventSlug}

Disallow: /dashboard
Disallow: /organizer
Disallow: /login
Disallow: /invite
Disallow: /styleguide
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.write(body);
  res.end();
  return { props: {} };
};

export default function RobotsTxt() {
  return null;
}
