/**
 * Blog posts, read from content/blog/*.md at build time.
 *
 * The markdown is reached through the bundled BLOG_SOURCE module rather than a
 * runtime `fs` read, the same approach as the help loader — content/ is not
 * traced into the serverless bundle, and the sitemap renders on the server.
 * BLOG_SOURCE is regenerated from the .md files with `npm run gen:blog`, and a
 * test fails if the two drift.
 *
 * Front matter: title, description, slug, date (YYYY-MM-DD), author.
 */

import { markdownToHtml, parseFrontMatter } from "../help/articles";
import { BLOG_SOURCE } from "./blogSource";

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  /** ISO date from front matter — sorts and feeds sitemap lastmod. */
  date: string;
  /** The same date for a reader: "September 9, 2026". */
  dateLabel: string;
  author: string;
};

export type BlogPost = BlogPostMeta & {
  bodyHtml: string;
  bodyMarkdown: string;
};

/** "2026-09-09" → "September 9, 2026". Formatted in UTC so the day never shifts. */
export function formatPostDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Drops the body's own title and byline lines.
 *
 * The post pages render the H1 and the "By {author}, {date}" byline from front
 * matter, so leaving these in would print each of them twice.
 */
function stripLeadingTitle(body: string): string {
  const lines = body.split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (lines.length && /^#\s+/.test(lines[0]!)) lines.shift();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (lines.length && /^\*By .+\*$/.test(lines[0]!.trim())) lines.shift();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  return lines.join("\n");
}

/** The file name is the canonical slug, so a route always resolves to a post. */
function toMeta(slug: string, raw: string): BlogPostMeta {
  const { meta } = parseFrontMatter(raw);
  const date = meta.date || "";
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || "",
    date,
    dateLabel: formatPostDate(date),
    author: meta.author || "",
  };
}

/** Every post, newest first. */
export function listPosts(): BlogPostMeta[] {
  return Object.entries(BLOG_SOURCE)
    .map(([slug, raw]) => toMeta(slug, raw))
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function getPost(slug: string): BlogPost | null {
  const safe = slug.replace(/[^a-z0-9-]/gi, "");
  if (!safe || safe !== slug) return null;
  const raw = BLOG_SOURCE[safe];
  if (!raw) return null;
  const { body } = parseFrontMatter(raw);
  const bodyMarkdown = stripLeadingTitle(body);
  return {
    ...toMeta(safe, raw),
    bodyMarkdown,
    bodyHtml: markdownToHtml(bodyMarkdown),
  };
}

export function blogPostPaths(): string[] {
  return listPosts().map((post) => `/blog/${post.slug}`);
}
